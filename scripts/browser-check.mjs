// QA opcional con Chrome instalado; no se necesita para ejecutar la tienda.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,open} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const run=path.join(root,'target','test-results','browser-'+Date.now());await mkdir(run,{recursive:true});
const out=await open(path.join(run,'server.log'),'w');
const app=spawn('java',[`-Dbikestore.data=${path.join(run,'data')}`,'-Dbikestore.testMode=true','-Dorg.slf4j.simpleLogger.defaultLogLevel=error','-jar',path.join(root,'target','bikestore-async-1.0.jar'),'18082'],{windowsHide:true,stdio:['ignore',out.fd,out.fd]});
let chrome,ws;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,timeout=20000){const end=Date.now()+timeout;let error;while(Date.now()<end){try{const value=await fn();if(value)return value}catch(e){error=e}await delay(150)}throw error||Error('Tiempo de espera agotado')}
try{
 await until(async()=> (await fetch('http://127.0.0.1:18082/api/catalog')).ok);
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=19222',`--user-data-dir=${path.join(run,'chrome-profile')}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 const targets=await until(async()=>{const r=await fetch('http://127.0.0.1:19222/json');const d=await r.json();return d.find(t=>t.type==='page')});
 ws=new WebSocket(targets.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let counter=0;const pending=new Map(),errors=[];
 ws.onmessage=event=>{const msg=JSON.parse(event.data);if(msg.id){const entry=pending.get(msg.id);if(entry){pending.delete(msg.id);msg.error?entry.reject(Error(JSON.stringify(msg.error))):entry.resolve(msg.result)}}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text)};
 function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++counter;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
 async function js(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
 await cdp('Page.enable');await cdp('Runtime.enable');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
 await cdp('Page.navigate',{url:'http://127.0.0.1:18082/'});
 await until(()=>js("document.querySelectorAll('[data-add]').length===6"));
 assert.equal(await js("document.querySelector('#simulation')===null"),true);
 await js("document.querySelector('[data-category=Montaña]').click()");
 assert.equal(await js("document.querySelectorAll('[data-add]').length"),2);
 await js("document.querySelector('[data-category=Todas]').click();document.querySelector('#search').value='Metro';document.querySelector('#search').dispatchEvent(new Event('input'))");
 assert.equal(await js("document.querySelectorAll('[data-add]').length"),1);
 await js("document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'))");
 const desktop=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(run,'tienda-desktop.png'),Buffer.from(desktop.data,'base64'));
 await js("document.querySelector('[data-add=metro]').click();document.querySelector('[data-add=summit]').click();document.querySelector('#open-cart').click();document.querySelector('[data-change=metro][data-step=\"1\"]').click()");
 assert.equal(await js("document.querySelector('#cart-count').textContent"),'3');
 await js("document.querySelector('#go-checkout').click()");
 await until(()=>js("!document.querySelector('#checkout-view').hidden"));
 // Fuerza éxito únicamente en esta instancia QA, que habilita el modo de prueba.
 await js(`window.originalFetch=window.fetch;window.fetch=(url,options)=>{if(url==='/api/orders'&&options?.method==='POST'){const body=JSON.parse(options.body);body.simulation='SUCCESS';options.body=JSON.stringify(body)}return window.originalFetch(url,options)};
 const form=document.querySelector('#checkout-form');for(const [key,value] of Object.entries({customerName:'Ana Pérez',email:'ana@example.com',address:'Av. Siempre Viva 123',city:'Quito'}))form.elements[key].value=value;form.requestSubmit();`);
 await until(()=>js("location.hash.startsWith('#pedido/')"));
 const id=await js("location.hash.slice(8)");
 await until(()=>js("document.querySelector('#order-detail').textContent.includes('¡Tu pedido está confirmado!')"));
 assert.equal(await js("document.querySelector('#order-detail').textContent.includes('Ana Pérez')"),true);
 await js(`location.hash='#correo/${id}'`);
 await until(()=>js("document.querySelector('#email-content').textContent.includes('1117.00')"));
 assert.equal(await js("document.querySelector('#email-content').textContent.includes('Metro City')"),true);
 const inbox=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(run,'buzon.png'),Buffer.from(inbox.data,'base64'));
 await cdp('Page.reload');await until(()=>js("document.querySelector('#email-content')?.textContent.includes('Ana Pérez')"));
 await js("location.hash='#tienda'");
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(300);
 assert.equal(await js('document.documentElement.scrollWidth <= innerWidth'),true);
 const mobile=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(run,'tienda-mobile.png'),Buffer.from(mobile.data,'base64'));
 assert.deepEqual(errors,[]);
 console.log('PASS: navegador real, catálogo, filtros, búsqueda, carrito, cantidades, checkout, seguimiento, buzón, recarga e interfaz móvil sin desbordamiento.');
 console.log('Capturas y evidencia: '+run);
 await writeFile(path.join(run,'resultado.txt'),'PASS: compra completa desde navegador y buzón local. Pedido: '+id);
}finally{
 if(ws)ws.close();if(chrome)chrome.kill();app.kill();await out.close();
}
