'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const controls = [...document.querySelectorAll('[data-scenario], #run-both')];
const terminal = new Set(['EMAIL_LOCAL', 'DLQ', 'PUBLISH_FAILED']);
const states = {PENDING:'Pedido recibido', PROCESSING:'Procesando el cobro', RETRYING:'Reintentando el cobro', PAID:'Pago aprobado; preparando confirmación', EMAIL_RETRY:'Reintentando entrega del correo local', EMAIL_LOCAL:'Confirmación entregada', DLQ:'Pago agotado; mensaje en DLQ', PUBLISH_FAILED:'No se pudo publicar el pedido'};
let running = false;

async function request(url, options) {
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'No se pudo completar la solicitud');
    return data;
}

function remember(id) {
    try {
        const saved = JSON.parse(localStorage.getItem('bikestore-orders-v2') || '[]');
        const ids = Array.isArray(saved) ? saved : [];
        if (!ids.includes(id)) ids.unshift(id);
        localStorage.setItem('bikestore-orders-v2', JSON.stringify(ids));
    } catch { /* El enlace del resultado permite abrir el pedido sin localStorage. */ }
}

async function loadDLQ() {
    $('#error').textContent = '';
    try {
        const messages = await request('/api/dlq');
        $('#messages').textContent = messages.length ? JSON.stringify(messages, null, 2) : 'No hay pedidos pendientes de revisión.';
        return messages;
    } catch (error) {
        $('#error').textContent = error.message;
        throw error;
    }
}

function render(card, order) {
    const retries = order.events.filter(event => event.detail.startsWith('PAYMENT_RETRY')).length;
    card.innerHTML = `<div class="lab-result-head"><h3>${order.simulation === 'SUCCESS' ? 'Pago exitoso' : 'Fallo y DLQ'}</h3><span class="pill">${esc(states[order.status] || order.status)}</span></div>
        <p class="order-meta">pedidoId: ${esc(order.pedidoId)}</p>
        <dl class="lab-facts"><div><dt>Intentos de cobro</dt><dd>${order.attempts} / 4</dd></div><div><dt>Reintentos</dt><dd>${retries} / 3</dd></div><div><dt>Estado del pago</dt><dd>${esc(order.paymentStatus)}</dd></div><div><dt>Correo</dt><dd>${esc(order.emailStatus)}</dd></div></dl>
        <p class="lab-check" aria-live="polite">Procesamiento en curso…</p>
        <div class="lab-links"><a href="/#pedido/${order.pedidoId}">Ver pedido →</a>${order.emailStatus === 'LOCAL_DELIVERED' ? `<a href="/#correo/${order.pedidoId}">Leer confirmación local →</a>` : ''}</div>
        <details class="lab-events"><summary>Eventos del pedido (${order.events.length})</summary><pre class="code">${esc(order.events.map(event => `timestamp=${event.timestamp} thread=${event.thread} pedidoId=${order.pedidoId} ${event.detail}`).join('\n'))}</pre></details>`;
}

async function check(order, scenario, messages) {
    const retries = order.events.filter(event => event.detail.startsWith('PAYMENT_RETRY')).length;
    if (scenario === 'SUCCESS') {
        const email = await request(`/api/orders/${order.pedidoId}/email`);
        if (order.status !== 'EMAIL_LOCAL' || order.paymentStatus !== 'PAID' || order.attempts !== 1 || retries !== 0
            || order.emailStatus !== 'LOCAL_DELIVERED' || email.delivery !== 'LOCAL' || !email.subject.includes(order.pedidoId)
            || messages.some(message => message.pedidoId === order.pedidoId)) throw Error('El resultado no coincide con un pago exitoso.');
        return 'PRUEBA CORRECTA · Pago aprobado al primer intento y confirmación disponible en el buzón local. Este pedido no está en la DLQ.';
    }
    const failed = messages.find(message => message.pedidoId === order.pedidoId);
    const email = await fetch(`/api/orders/${order.pedidoId}/email`);
    if (order.status !== 'DLQ' || order.paymentStatus !== 'FAILED' || order.attempts !== 4 || retries !== 3
        || order.emailStatus !== 'NOT_SENT' || !failed || failed.paymentStatus !== 'FAILED' || failed.attempts !== 4
        || email.status !== 404) throw Error('El resultado no coincide con tres reintentos agotados y ausencia de correo.');
    return 'PRUEBA CORRECTA · Cuatro intentos, tres reintentos y pedido en la DLQ de abajo. Se comprobó que no existe un correo para este pedido.';
}

async function runScenario(scenario) {
    const card = document.createElement('article');
    card.className = 'lab-result';
    card.innerHTML = '<p>Publicando pedido de demostración…</p>';
    $('#test-results').prepend(card);
    try {
        const accepted = await request('/api/lab/orders', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenario})});
        card.dataset.pedidoId = accepted.pedidoId;
        card.dataset.scenario = scenario;
        remember(accepted.pedidoId);
        const deadline = Date.now() + 90000;
        while (Date.now() < deadline) {
            const order = await request(`/api/orders/${accepted.pedidoId}`);
            const opened = card.querySelector('details')?.open;
            render(card, order);
            if (opened) card.querySelector('details').open = true;
            if (terminal.has(order.status)) {
                const messages = await loadDLQ();
                const result = await check(order, scenario, messages);
                card.dataset.outcome = 'PASS';
                card.querySelector('.lab-check').textContent = result;
                return;
            }
            await delay(400);
        }
        throw Error('La prueba sigue pendiente. Abre el pedido para consultar su estado y revisa la consola.');
    } catch (error) {
        card.dataset.outcome = 'ERROR';
        let message = card.querySelector('.lab-check');
        if (!message) { message = document.createElement('p'); card.append(message); }
        message.classList.add('error'); message.textContent = error.message;
        throw error;
    }
}

async function run(scenarios) {
    if (running) return;
    running = true; controls.forEach(button => button.disabled = true);
    $('#test-error').textContent = '';
    try {
        for (let index = 0; index < scenarios.length; index++) {
            $('#test-status').textContent = `Ejecutando prueba ${index + 1} de ${scenarios.length}: ${scenarios[index] === 'SUCCESS' ? 'pago exitoso' : 'fallo y tres reintentos'}…`;
            await runScenario(scenarios[index]);
        }
        $('#test-status').textContent = scenarios.length === 2 ? 'Ambas pruebas finalizaron correctamente. Puedes revisar los pedidos, leer la confirmación y descargar la DLQ.' : 'Prueba finalizada correctamente. Revisa el resultado a continuación.';
    } catch (error) {
        $('#test-status').textContent = 'No se pudo completar la comprobación.';
        $('#test-error').textContent = error.message;
    } finally { running = false; controls.forEach(button => button.disabled = false); }
}

controls.forEach(button => button.addEventListener('click', () => run(button.id === 'run-both' ? ['SUCCESS', 'FAIL'] : [button.dataset.scenario])));
$('#refresh').addEventListener('click', () => loadDLQ().catch(() => {}));
loadDLQ().catch(() => {});
