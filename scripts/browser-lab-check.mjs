// QA del panel integrado, sin habilitar bikestore.testMode.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=path.join(root,'target','test-results','panel-'+Date.now());await mkdir(run,{recursive:true});
const out=await open(path.join(run,'server.log'),'w');
const app=spawn('java',[`-Dbikestore.data=${path.join(run,'data')}`,'-Dorg.slf4j.simpleLogger.defaultLogLevel=error','-jar',path.join(root,'target','bikestore-async-1.0.jar'),'18083'],{windowsHide:true,stdio:['ignore',out.fd,out.fd]});
let chrome,ws;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,timeout=25000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{const value=await fn();if(value)return value}catch(e){error=e}await delay(100)}throw error||Error('Tiempo de espera agotado')}
try{
 await until(async()=> (await fetch('http://127.0.0.1:18083/api/catalog')).ok);
 const config=await (await fetch('http://127.0.0.1:18083/api/config')).json();assert.equal(config.testMode,false);
 const invalid=await fetch('http://127.0.0.1:18083/api/lab/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:'INVALID'})});assert.equal(invalid.status,400);
 const normal=await fetch('http://127.0.0.1:18083/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({customerName:'Cliente normal',email:'normal@example.com',address:'Direccion 123',city:'Quito',items:[{productId:'metro',quantity:1}],simulation:'SUCCESS'})});assert.equal(normal.status,400);
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=19224',`--user-data-dir=${path.join(run,'chrome-profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const target=await until(async()=> (await (await fetch('http://127.0.0.1:19224/json')).json()).find(t=>t.type==='page'));
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let counter=0;const pending=new Map(),errors=[];
 ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(JSON.stringify(msg.error))):entry.resolve(msg.result)}}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text)};
 function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
 async function js(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
 await cdp('Page.enable');await cdp('Runtime.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:'http://127.0.0.1:18083/laboratorio'});
 await until(()=>js("document.querySelector('#messages')?.textContent.includes('No hay pedidos')"));
 await js("document.querySelector('#run-both').click()");
 assert.equal(await js("[...document.querySelectorAll('[data-scenario],#run-both')].every(button=>button.disabled)"),true);
 await until(()=>js("document.querySelector('.lab-result')?.textContent.includes('Procesamiento en curso')"));
 await until(()=>js("document.querySelectorAll('.lab-result[data-outcome=PASS]').length===2"));
 await until(()=>js("!document.querySelector('#run-both').disabled"));
 const results=await js("[...document.querySelectorAll('.lab-result')].map(card=>({id:card.dataset.pedidoId,scenario:card.dataset.scenario,outcome:card.dataset.outcome}))");
 const ok=results.find(r=>r.scenario==='SUCCESS'),fail=results.find(r=>r.scenario==='FAIL');
 const messages=await (await fetch('http://127.0.0.1:18083/api/dlq')).json();
 assert.equal(messages.length,1);assert.equal(messages[0].pedidoId,fail.id);assert.equal(messages[0].status,'DLQ');assert.equal(messages[0].emailStatus,'NOT_SENT');
 assert.equal(await js(`document.querySelector('#messages').textContent.includes('${fail.id}')`),true);
 assert.equal(await js("document.querySelector('#test-error').textContent"),'');
 assert.equal(await js("JSON.parse(localStorage.getItem('bikestore-orders-v2')).length"),2);
 const failed=await (await fetch('http://127.0.0.1:18083/api/orders/'+fail.id)).json();
 assert.equal(failed.demo,true);assert.equal(failed.attempts,4);assert.equal(failed.events.filter(e=>e.detail.startsWith('PAYMENT_RETRY')).length,3);
 for(const event of failed.events){assert.ok(event.timestamp);assert.ok(event.thread)}
 assert.equal((await fetch(`http://127.0.0.1:18083/api/orders/${fail.id}/email`)).status,404);
 await js(`document.querySelector('[data-pedido-id="${fail.id}"] details').open=true`);
 const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(run,'panel-desktop.png'),Buffer.from(shot.data,'base64'));
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
 assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
 const mobile=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(run,'panel-mobile.png'),Buffer.from(mobile.data,'base64'));
 await js("document.querySelector('[data-scenario=FAIL]').click()");
 await until(()=>js("document.querySelectorAll('.lab-result[data-outcome=PASS]').length===3 && !document.querySelector('#run-both').disabled"));
 await js("document.querySelector('[data-scenario=SUCCESS]').click()");
 await until(()=>js("document.querySelectorAll('.lab-result[data-outcome=PASS]').length===4 && !document.querySelector('#run-both').disabled"));
 const retained=await (await fetch('http://127.0.0.1:18083/api/dlq')).json();assert.equal(retained.length,2);assert.ok(retained.some(m=>m.pedidoId===fail.id));
 await js(`document.querySelector('[data-pedido-id="${ok.id}"] a[href*="#correo/"]').click()`);
 await until(()=>js("document.querySelector('#email-content')?.textContent.includes('Cliente de demostracion')"));
 assert.equal(await js("document.querySelectorAll('[data-add]').length"),6);
 assert.equal(await js("document.querySelector('#simulation')===null"),true);
 assert.deepEqual(errors,[]);
 await writeFile(path.join(run,'resultado.json'),JSON.stringify({result:'PASS',defaultMode:true,tests:results,retainedDlq:retained.length},null,2));
 console.log('PASS: panel sin flags, ambas pruebas e individuales, seguimiento, cuatro intentos/tres reintentos, DLQ de la misma instancia, correo condicionado, enlace al buzon, historial, controles, validacion y vista movil.');
 console.log('Evidencia: '+run);
 await cdp('Browser.close');
}finally{if(ws)ws.close();if(chrome&&!chrome.killed)chrome.kill();app.kill();await out.close()}
