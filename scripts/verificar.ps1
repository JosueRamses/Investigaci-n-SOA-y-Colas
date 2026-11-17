$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $projectRoot
$run = Join-Path $projectRoot ('target/test-results/integracion-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $run -Force | Out-Null
$app = $null
$base = 'http://127.0.0.1:18081'
$jar = if (Test-Path 'bikestore-async-1.0.jar') { 'bikestore-async-1.0.jar' } else { 'target/bikestore-async-1.0.jar' }
function Start-App([string]$suffix) {
    $script:app = Start-Process java -ArgumentList @("`"-Dbikestore.data=$run/data`"", '-Dbikestore.testMode=true', '-Dorg.slf4j.simpleLogger.defaultLogLevel=warn', '-jar', $jar, '18081') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$run/$suffix.log" -RedirectStandardError "$run/$suffix.err.log"
    for ($n=0; $n -lt 80; $n++) {
        if ($script:app.HasExited) { throw "La aplicacion termino. Revisar $run/$suffix.err.log" }
        try { $null = Invoke-RestMethod "$base/api/dlq" -TimeoutSec 1; return } catch { Start-Sleep -Milliseconds 250 }
    }
    throw 'La aplicacion no inicio a tiempo'
}
function Order([string]$mode) {
    $body = @{customerName='Cliente de prueba';email='cliente@example.com';address='Av. Principal 123';city='Quito';items=@(@{productId='metro';quantity=2},@{productId='summit';quantity=1});simulation=$mode;totalCents=1} | ConvertTo-Json -Depth 5
    $response = Invoke-WebRequest "$base/api/orders" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing
    if ($response.StatusCode -ne 202) { throw 'La API debe devolver HTTP 202' }
    return ($response.Content | ConvertFrom-Json).pedidoId
}
function Wait-Status([string]$id, [string]$expected) {
    for ($n=0; $n -lt 80; $n++) {
        $status = (Invoke-RestMethod "$base/api/orders/$id").status
        if ($status -eq $expected) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "Pedido $id no alcanzo $expected, estado=$status"
}
try {
    Start-App 'primera-ejecucion'
    $page = Invoke-WebRequest $base -UseBasicParsing
    if ($page.StatusCode -ne 200) { throw 'Frontend no disponible' }
    $ok = Order 'SUCCESS'
    $fail = Order 'FAIL'
    Wait-Status $ok 'EMAIL_LOCAL'
    Wait-Status $fail 'DLQ'
    $letters = @(Invoke-RestMethod "$base/api/dlq")
    if ($letters.Count -ne 1 -or $letters[0].pedidoId -ne $fail -or $letters[0].attempts -ne 4 -or $letters[0].paymentStatus -ne 'FAILED') { throw 'DLQ incorrecta' }
    if (!(Test-Path "$run/data/emails/$ok.eml")) { throw 'No se guardo correo SMTP' }
    if (Test-Path "$run/data/emails/$fail.eml") { throw 'Se envio correo de un pago fallido' }
    $order = Invoke-RestMethod "$base/api/orders/$ok"
    if ($order.totalCents -ne 111700 -or $order.items.Count -ne 2) { throw 'El servidor no calculo bien el carrito' }
    if ($order.emailStatus -ne 'LOCAL_DELIVERED' -or $order.paymentStatus -ne 'PAID') { throw 'Estado de pago o correo incorrecto' }
    $email = Invoke-RestMethod "$base/api/orders/$ok/email"
    if ($email.delivery -ne 'LOCAL' -or $email.body -notmatch 'Metro City' -or $email.body -notmatch 'Summit 29' -or $email.body -notmatch '1117.00') { throw 'Confirmacion sin detalle del pedido' }
    $catalog = Invoke-RestMethod "$base/api/catalog"
    if ($catalog.Count -ne 6) { throw 'Catalogo incompleto' }
    foreach ($asset in @('/app.js','/styles.css','/laboratorio')) {
        if ((Invoke-WebRequest "$base$asset" -UseBasicParsing).StatusCode -ne 200) { throw "Recurso no disponible: $asset" }
    }
    $logs = Get-Content "$run/primera-ejecucion.log"
    $attempts = @($logs | Where-Object { $_ -match "pedidoId=$fail PAYMENT_ATTEMPT" })
    $retries = @($logs | Where-Object { $_ -match "pedidoId=$fail PAYMENT_RETRY" })
    if ($attempts.Count -ne 4 -or $retries.Count -ne 3) { throw 'Numero de intentos incorrecto' }
    foreach ($line in ($logs | Where-Object { $_ -match 'pedidoId=' })) {
        if ($line -notmatch '^timestamp=\S+ thread=\S+ pedidoId=\S+ ') { throw "Registro incompleto: $line" }
    }
    try {
        $null = Invoke-WebRequest "$base/api/orders" -Method Post -ContentType 'application/json' -Body '{"email":"invalido","bike":"Bike"}' -UseBasicParsing
        throw 'Se acepto email invalido'
    } catch { if ($_.Exception.Response.StatusCode.value__ -ne 400) { throw } }
    # Fuerza cierre del proceso para comprobar recuperacion desde el journal.
    Stop-Process -Id $app.Id -Force
    $app.WaitForExit()
    Start-App 'reinicio'
    Wait-Status $ok 'EMAIL_LOCAL'
    Wait-Status $fail 'DLQ'
    $persisted = @(Invoke-RestMethod "$base/api/dlq")
    if ($persisted.Count -ne 1 -or $persisted[0].pedidoId -ne $fail) { throw 'DLQ no persistente' }
    $restored = Invoke-RestMethod "$base/api/orders/$ok"
    if ($restored.totalCents -ne 111700 -or $restored.customerName -ne 'Cliente de prueba') { throw 'Pedido no persistente' }
    $restoredEmail = Invoke-RestMethod "$base/api/orders/$ok/email"
    if ($restoredEmail.subject -notmatch $ok) { throw 'Buzon no persistente' }
    $persisted | ConvertTo-Json -Depth 5 | Set-Content "$run/dlq-export.json" -Encoding UTF8
    "PASS: catalogo, recursos web, carrito de varios productos, precios calculados en servidor, HTTP 202, SMTP local, buzon, pago, tres reintentos, DLQ, ausencia de correo para fallo, registros, HTTP 400 y persistencia de pedidos/buzon/DLQ tras reinicio."
    "Evidencia: $run"
} finally {
    if ($app -and !$app.HasExited) { Stop-Process -Id $app.Id -Force; $app.WaitForExit() }
    Pop-Location
}
