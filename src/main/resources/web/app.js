'use strict';
const $ = s => document.querySelector(s);
const money = cents => new Intl.NumberFormat('es-EC', {style:'currency',currency:'USD'}).format(cents / 100);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function saved(key, fallback){try{return JSON.parse(localStorage.getItem(key)) ?? fallback}catch{return fallback}}
let products = [], cart = saved('bikestore-cart-v2', {}), orderIds = saved('bikestore-orders-v2', []), category = 'Todas', poll, toastTimer;
if (!cart || Array.isArray(cart) || typeof cart !== 'object') cart = {};
if (!Array.isArray(orderIds)) orderIds = [];
async function api(url, options){const response=await fetch(url,options);const data=await response.json();if(!response.ok)throw Error(data.error||'No se pudo completar la solicitud');return data}
function persist(){try{localStorage.setItem('bikestore-cart-v2',JSON.stringify(cart));localStorage.setItem('bikestore-orders-v2',JSON.stringify(orderIds))}catch{toast('El navegador no permite guardar el historial. Conserva el número de tu pedido.')}}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3000)}
function bike(color='#51a898',category='Montaña'){
 const road=category==='Ruta';
 return `<svg class="bike-art" viewBox="0 0 540 330" role="img" aria-label="Ilustración de bicicleta"><ellipse cx="270" cy="291" rx="225" ry="12" fill="#17352a" opacity=".07"/><g fill="none" stroke="#253b33"><circle cx="112" cy="210" r="77" stroke-width="13"/><circle cx="426" cy="210" r="77" stroke-width="13"/><circle cx="112" cy="210" r="67" stroke="#a2aaa0" stroke-width="2"/><circle cx="426" cy="210" r="67" stroke="#a2aaa0" stroke-width="2"/><g stroke="#a0aaa0" stroke-width="1">${[0,30,60,90,120,150].map(a=>`<path d="M35 210h154M349 210h154" transform="rotate(${a} 112 210)"/>`).slice(0,1).join('')}${[0,30,60,90,120,150].map(a=>`<path d="M35 210h154" transform="rotate(${a} 112 210)"/><path d="M349 210h154" transform="rotate(${a} 426 210)"/>`).join('')}</g><path d="M112 210 207 104 258 210 112 210 202 108 367 108 258 210" stroke="${color}" stroke-width="12" stroke-linejoin="round"/><path d="m356 83 70 127" stroke="${color}" stroke-width="13"/><path d="m204 108-15-36m-24 0h53" stroke-width="9" stroke-linecap="round"/><path d="m363 98-13-39h46${road?'q28 0 20 28l-14 6':'l14-12'}" stroke-width="8" stroke-linecap="round"/><path d="m257 211 35 25m-8 1h25m-55-25-35-23m-13-1h23" stroke-width="5"/><circle cx="257" cy="211" r="19" stroke-width="4"/><path d="M112 210h145" stroke-width="3" opacity=".5"/></g><circle cx="112" cy="210" r="5" fill="#253b33"/><circle cx="426" cy="210" r="5" fill="#253b33"/></svg>`;
}
function lines(){return products.filter(p=>cart[p.id]).map(p=>({...p,quantity:cart[p.id]}))}
function total(){return lines().reduce((sum,p)=>sum+p.priceCents*p.quantity,0)}
function renderProducts(){
 const query=$('#search').value.trim().toLocaleLowerCase();
 const visible=products.filter(p=>(category==='Todas'||p.category===category)&&`${p.name} ${p.description}`.toLocaleLowerCase().includes(query));
 $('#product-count').textContent=`${visible.length} bicicletas para descubrir`;
 $('#products').innerHTML=visible.length?visible.map(p=>`<article class="product"><div class="product-art"><span class="badge">${esc(p.badge)}</span>${bike(p.color,p.category)}</div><p class="product-category">${esc(p.category)}</p><div class="product-title"><h3>${esc(p.name)}</h3><strong>${money(p.priceCents)}</strong></div><p class="product-description">${esc(p.description)}</p><button class="add-button" data-add="${p.id}">Agregar al carrito <span>＋</span></button></article>`).join(''):'<p class="muted">No encontramos bicicletas con esa búsqueda.</p>';
}
function lineHTML(p, editable){return `<div class="cart-line"><div class="mini-art">${bike(p.color,p.category)}</div><div><h3>${esc(p.name)}</h3><p>${money(p.priceCents)} ${editable?'por unidad':`× ${p.quantity}`}</p>${editable?`<div class="quantity"><button data-change="${p.id}" data-step="-1" aria-label="Quitar una ${esc(p.name)}">−</button><b>${p.quantity}</b><button data-change="${p.id}" data-step="1" aria-label="Agregar una ${esc(p.name)}">+</button><button class="remove" data-remove="${p.id}">Quitar</button></div>`:`<b>${money(p.priceCents*p.quantity)}</b>`}</div></div>`}
function empty(title,text){return `<div class="empty"><h2>${title}</h2><p>${text}</p><a class="button dark" href="#tienda">Explorar bicicletas ↗</a></div>`}
function renderCart(){
 const items=lines(), count=items.reduce((s,p)=>s+p.quantity,0);
 $('#cart-count').textContent=count;$('#drawer-count').textContent=`(${count})`;
 $('#cart-items').innerHTML=items.length?items.map(p=>lineHTML(p,true)).join(''):empty('Tu próxima aventura te espera.','Agrega una bicicleta para comenzar tu pedido.');
 $('#cart-bottom').hidden=!items.length;$('#cart-total').textContent=money(total());
 $('#checkout-items').innerHTML=items.map(p=>lineHTML(p,false)).join('');$('#checkout-total').textContent=money(total());
}
function date(value){return new Date(value).toLocaleString('es-EC',{dateStyle:'medium',timeStyle:'short'})}
function state(order){
 return ({PENDING:['Pedido recibido','Estamos preparando el procesamiento de tu pago.'],PROCESSING:['Procesando tu pago','Puedes continuar explorando. Actualizaremos tu pedido automáticamente.'],RETRYING:['Estamos reintentando el pago','El cobro no pudo completarse. Volveremos a intentarlo automáticamente.'],PAID:['¡Pago aprobado!','Tu compra está confirmada. Estamos preparando el mensaje de confirmación.'],EMAIL_RETRY:['Compra confirmada','Tu pago fue aprobado; estamos reintentando la entrega de la confirmación.'],EMAIL_LOCAL:['¡Tu pedido está confirmado!','Tu pago fue aprobado. La confirmación está disponible en Mi buzón.'],DLQ:['No pudimos completar el pago','Se agotaron los tres reintentos. No se confirmó la compra ni se envió un correo. El pedido quedó registrado para revisión.'],PUBLISH_FAILED:['No se pudo registrar el pedido','Vuelve a la tienda e intenta crear un nuevo pedido.']})[order.status]||['Pedido registrado','Consulta nuevamente en unos momentos.'];
}
function remember(id){if(!orderIds.includes(id)){orderIds.unshift(id);persist()}}
async function fetchOrders(){return (await Promise.all(orderIds.map(async id=>{try{return await api('/api/orders/'+encodeURIComponent(id))}catch{return null}}))).filter(Boolean)}
async function renderOrders(){
 const orders=await fetchOrders();if(location.hash!=='#pedidos')return;
 $('#orders-list').innerHTML=orders.length?orders.map(o=>`<article class="order-card"><div><p class="order-meta">${date(o.timestamp)} · #${esc(o.pedidoId.slice(0,8))}</p><h3>${esc(o.bike)}</h3><span class="pill ${o.status==='DLQ'?'failed':''}">${state(o)[0]}</span></div><div><h3>${money(o.totalCents)}</h3><a class="back" href="#pedido/${o.pedidoId}">Ver mi pedido →</a></div></article>`).join(''):empty('Aún no tienes pedidos.','Tu historial aparecerá aquí después de tu primera compra.');
}
const detailLabels={ORDER_ACCEPTED:'Recibimos tu pedido',PAYMENT_ATTEMPT:'Procesamos el pago',PAYMENT_RETRY:'Reintento automático de cobro',PAYMENT_PAID:'Pago aprobado',DEAD_LETTER_QUEUE:'Pago rechazado: pedido pendiente de revisión',EMAIL_DELIVERED:'Confirmación entregada en tu buzón local',EMAIL_RETRY:'Reintentando la entrega de la confirmación'};
async function renderDetail(id){
 try{
 const order=await api('/api/orders/'+encodeURIComponent(id));if(location.hash!==`#pedido/${id}`)return;
 const [title,description]=state(order);const failed=['DLQ','PUBLISH_FAILED'].includes(order.status);
 $('#order-detail').innerHTML=`<p class="eyebrow">CADA PASO DE TU COMPRA</p><h1>Tu pedido.</h1><p class="order-meta">Número de pedido: ${esc(id)}<br>${date(order.timestamp)}</p><div class="status-banner ${failed?'failed':''}" role="status"><h2>${title}</h2><p>${description}</p></div><div class="detail-layout"><div class="panel"><h2>Resumen de compra</h2>${order.items.map(item=>`<div class="total-row"><span>${item.quantity} × ${esc(item.name)}</span><b>${money(item.subtotalCents)}</b></div>`).join('')}<div class="total-row grand"><span>Total</span><b>${money(order.totalCents)}</b></div><h3>Datos de entrega</h3><p class="muted">${esc(order.customerName)}<br>${esc(order.address)}, ${esc(order.city)}<br>${esc(order.email)}</p><p class="local-note">Pago simulado · Tarjeta demo ···· 4242<br>Confirmación de correo en el buzón local de la tienda.</p>${order.emailStatus==='LOCAL_DELIVERED'?`<a class="button dark" href="#correo/${id}">Leer mi confirmación ↗</a>`:''}</div><div class="panel"><h2>Seguimiento del pedido</h2><ol class="timeline">${order.events.map(e=>`<li>${detailLabels[e.detail.split(' ')[0]]||'Pedido actualizado'}${e.detail.startsWith('PAYMENT_ATTEMPT')?` · intento ${esc(e.detail.split('=')[1])}`:''}<small>${date(e.timestamp)}</small></li>`).join('')}</ol></div></div>`;
 if(!['EMAIL_LOCAL','DLQ','PUBLISH_FAILED'].includes(order.status))poll=setTimeout(()=>renderDetail(id),900);
 }catch(error){$('#order-detail').innerHTML=`<div class="empty"><h2>No pudimos consultar el pedido</h2><p>${esc(error.message)}</p><a class="button dark" href="#pedidos">Volver a mis pedidos</a></div>`}
}
async function renderInbox(selected){
 const orders=(await fetchOrders()).filter(o=>o.emailStatus==='LOCAL_DELIVERED');
 if(!location.hash.startsWith('#buzon')&&!location.hash.startsWith('#correo/'))return;
 $('#mail-count').textContent=orders.length;
 $('#inbox-list').innerHTML=orders.length?orders.map(o=>`<a class="inbox-message" href="#correo/${o.pedidoId}"><div><b>Tu pedido está confirmado · #${esc(o.pedidoId.slice(0,8))}</b><small>Para ${esc(o.email)} · ${date(o.timestamp)}</small></div><span>↗</span></a>`).join(''):empty('Tu buzón está listo.','Las confirmaciones aparecerán aquí cuando se apruebe el pago de tus pedidos.');
 $('#email-content').hidden=!selected;
 if(selected){try{const message=await api('/api/orders/'+encodeURIComponent(selected)+'/email');if(location.hash!==`#correo/${selected}`)return;$('#email-content').innerHTML=`<p class="eyebrow">CONFIRMACIÓN RECIBIDA</p><h2>${esc(message.subject)}</h2><p class="muted">De: BikeStore · Para: ${esc(message.to)}</p><p class="local-note">Entregado por SMTP al servidor local de demostración. Este mensaje no se envió a tu buzón de Internet.</p><div class="email-body">${esc(message.body)}</div>`}catch(error){$('#email-content').innerHTML=`<p class="error">${esc(error.message)}</p>`}}
}
function route(){
 clearTimeout(poll);const hash=location.hash||'#tienda';
 for(const id of ['shop','checkout','orders','detail','inbox'])$(`#${id}-view`).hidden=true;
 if(hash==='#checkout'){if(!lines().length){location.hash='#tienda';toast('Agrega una bicicleta antes de confirmar.');return}$('#checkout-view').hidden=false;renderCart()}
 else if(hash==='#pedidos'){$('#orders-view').hidden=false;$('#orders-list').innerHTML='<p class="loading">Consultando tus pedidos…</p>';renderOrders()}
 else if(hash.startsWith('#pedido/')){$('#detail-view').hidden=false;$('#order-detail').innerHTML='<p class="loading">Consultando tu pedido…</p>';renderDetail(hash.slice(8))}
 else if(hash==='#buzon'||hash.startsWith('#correo/')){$('#inbox-view').hidden=false;$('#inbox-list').innerHTML='<p class="loading">Abriendo tu buzón…</p>';renderInbox(hash.startsWith('#correo/')?hash.slice(8):null)}
 else $('#shop-view').hidden=false;
 if(hash==='#catalogo')$('#catalogo').scrollIntoView({behavior:'smooth'});else window.scrollTo(0,0);
}
document.addEventListener('click',event=>{
 const add=event.target.closest('[data-add]'),change=event.target.closest('[data-change]'),remove=event.target.closest('[data-remove]'),filter=event.target.closest('[data-category]');
 if(add){const id=add.dataset.add;if((cart[id]||0)>=5){toast('Puedes pedir hasta cinco unidades por modelo.');return}cart[id]=(cart[id]||0)+1;persist();renderCart();toast(`${products.find(p=>p.id===id).name} se agregó al carrito`)}
 if(change){const id=change.dataset.change;const next=cart[id]+Number(change.dataset.step);if(next>5){toast('Máximo cinco unidades por modelo.');return}if(next<1)delete cart[id];else cart[id]=next;persist();renderCart()}
 if(remove){delete cart[remove.dataset.remove];persist();renderCart()}
 if(filter){category=filter.dataset.category;document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===filter));renderProducts()}
 if(event.target.closest('#cart-items a'))$('#cart-dialog').close();
});
$('#search').addEventListener('input',renderProducts);
$('#open-cart').onclick=()=>{$('#cart-dialog').showModal();renderCart()};$('#close-cart').onclick=()=>$('#cart-dialog').close();
$('#go-checkout').onclick=()=>{$('#cart-dialog').close();location.hash='#checkout'};
$('#cart-dialog').addEventListener('click',event=>{if(event.target===$('#cart-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right)event.target.close()}});
$('#checkout-form').onsubmit=async event=>{
 event.preventDefault();const button=$('#place-order');button.disabled=true;button.textContent='Confirmando tu pedido…';$('#checkout-error').textContent='';
 try{const input=Object.fromEntries(new FormData(event.target));input.items=lines().map(p=>({productId:p.id,quantity:p.quantity}));const response=await api('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});remember(response.pedidoId);cart={};persist();renderCart();event.target.reset();location.hash='#pedido/'+response.pedidoId}
 catch(error){$('#checkout-error').textContent=error.message}finally{button.disabled=false;button.textContent='Confirmar pedido →'}
};
$('#lookup-form').onsubmit=async event=>{event.preventDefault();$('#lookup-error').textContent='';try{const id=$('#lookup-id').value.trim();await api('/api/orders/'+encodeURIComponent(id));remember(id);location.hash='#pedido/'+id}catch(error){$('#lookup-error').textContent=error.message}};
window.addEventListener('hashchange',route);
async function init(){
 $('#hero-bike').innerHTML=bike('#46684d');
 try{products=await api('/api/catalog');for(const id of Object.keys(cart)){if(!products.some(p=>p.id===id)||!Number.isInteger(cart[id])||cart[id]<1||cart[id]>5)delete cart[id]}renderProducts();renderCart();route();const orders=await fetchOrders();$('#mail-count').textContent=orders.filter(o=>o.emailStatus==='LOCAL_DELIVERED').length}
 catch(error){$('#products').innerHTML=`<p class="error">${esc(error.message)}. Comprueba que la aplicación Java esté ejecutándose y recarga la página.</p>`}
}
init();
