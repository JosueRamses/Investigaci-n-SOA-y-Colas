# BikeStore Async v1.0

Tienda académica en **Java 21** con catálogo, carrito, checkout, seguimiento, historial y buzón local. Apache Artemis procesa los pedidos mediante mensajes JSON y dos consumidores independientes.

## Iniciar

Desde el código fuente se necesitan **JDK 21 y Maven**:

```powershell
mvn package -DskipTests
java -jar target/bikestore-async-1.0.jar
```

Abrir **http://localhost:8080**. Mantener la terminal abierta y detener con **Ctrl+C**.

En Windows también se puede abrir **iniciar.bat**. Compila si falta el JAR. La primera compilación necesita Internet o las dependencias ya descargadas. Si existe la caché local `.m2/`, el archivo de inicio la utiliza.

El ZIP listo para ejecutar está en `dist/`. Después de extraerlo, basta **Java 21** y abrir `iniciar.bat`: incluye el JAR y no requiere Maven, Docker ni servidores externos.

Puerto alternativo:

```powershell
java -jar target/bikestore-async-1.0.jar 8081
```

## Probar desde la aplicación

1. Agregar bicicletas al carrito, indicar cantidades y completar los datos de entrega.
2. Confirmar el pedido y observar cómo cambia su estado en segundo plano.
3. Si se aprueba el pago, leer la confirmación en **Mi buzón**.
4. Entrar al **Panel del ejercicio** desde el pie de página o abrir http://localhost:8080/laboratorio.
5. Pulsar **Ejecutar ambas pruebas** para demostrar éxito y fallo sin depender del azar. También hay botones individuales.

El panel comprueba el pago exitoso y su correo; para el fallo, comprueba cuatro intentos, tres reintentos, presencia en la DLQ y ausencia de correo. Los pedidos ficticios se guardan en esa misma instancia, con `demo=true`. La DLQ se actualiza automáticamente y se puede descargar en JSON. Las compras normales mantienen un 50 % de probabilidad de fallo por intento.

**El cobro es simulado y el correo es local.** No se realizan cargos ni se envían mensajes a Gmail u Outlook. EmailWorker entrega la confirmación al servidor SMTP GreenMail incluido; se puede leer en la aplicación o en `data/emails/`.

## Estructura

```text
src/main/java/edu/bikestore/    Backend Java
  BikeStore.java              API OrderProducer, PaymentWorker y EmailWorker
  Broker.java                 Artemis, colas y transacciones
  Catalog.java                Catalogo y validacion de precios y cantidades
  OrderStore.java             Pedidos y seguimiento en disco
  MailService.java            Correo SMTP local
src/main/resources/web/       Interfaz de la tienda y panel del ejercicio
scripts/                      Pruebas y empaquetado
pom.xml                       Dependencias y compilacion Maven
iniciar.bat                   Inicio en Windows
```

Carpetas locales generadas, excluidas de Git:

| Carpeta | Contenido |
| --- | --- |
| `target/` | Compilación, JAR y resultados temporales de pruebas. |
| `dist/` | ZIP de distribución, generado bajo demanda. |
| `.m2/` | Caché local de dependencias Maven, si se utiliza. |
| `data/` | Pedidos, mensajes persistentes y correos de la aplicación. |
| `.archive/` | Entregas y resultados anteriores conservados de forma recuperable durante la organización. |
| `docs/` | Informes académicos locales, entregados por separado y excluidos de GitHub. |

`data/` se conserva entre ejecuciones. No contiene código fuente y no se incluye en el ZIP ni en GitHub.

## Flujo asíncrono

```text
Checkout → API OrderProducer → Artemis: orders → PaymentWorker
                                                   ├─ PAID → payments.paid → EmailWorker → buzon local
                                                   └─ fallo + 3 reintentos → orders.dlq
```

La API responde HTTP 202 después de publicar el pedido. Cada consumidor trabaja en su propio hilo. PaymentWorker realiza un intento inicial y hasta tres reintentos, con esperas de 250, 500 y 1000 ms. Publicar el resultado y confirmar el mensaje original forman una transacción del bróker. Cada evento registra `pedidoId`, `timestamp` y `thread` en consola.

Artemis es un bróker real embebido y persistente, accesible dentro de la JVM. Los componentes se empaquetan en un único proceso; no son microservicios desplegados por separado. Las transacciones del bróker no incluyen automáticamente los archivos de pedidos ni el SMTP. Puede haber reentregas ante caídas.

## Pruebas opcionales de desarrollo

El panel no requiere comandos. Para comprobar también la persistencia después de un cierre forzado:

```powershell
.\scripts\verificar.ps1
```

Pruebas de navegador, con **Node 22 y Chrome instalado en Windows**:

```powershell
node scripts/browser-check.mjs
node scripts/browser-lab-check.mjs
```

Las pruebas usan procesos y datos aislados en los puertos 18081, 18082 y 18083. Guardan logs, pedidos y capturas en `target/test-results/`. No modifican los pedidos de `data/`.

## Generar el ZIP de entrega

Después de compilar:

```powershell
.\scripts\empaquetar.ps1
```

Genera `dist/BikeStore-Async-v1.0.zip` con el JAR, el código fuente, el README y los scripts. Los informes académicos se entregan por separado. No incluye cachés, datos de clientes, perfiles de navegador ni resultados temporales. La carpeta de preparación se elimina al terminar.

## API

| Método y ruta | Función |
| --- | --- |
| `GET /api/catalog` | Catálogo y precios en centavos. |
| `POST /api/orders` | Aceptar un pedido; respuesta HTTP 202. |
| `GET /api/orders/{pedidoId}` | Consultar estado, datos y eventos. |
| `GET /api/orders/{pedidoId}/email` | Leer la confirmación local disponible. |
| `POST /api/lab/orders` | Crear un pedido fijo de demostración: `SUCCESS` o `FAIL`. |
| `GET /api/dlq` | Inspeccionar o descargar mensajes fallidos sin retirarlos. |

Ejemplo para `POST /api/orders`:

```json
{
  "customerName": "Ana Pérez",
  "email": "ana@ejemplo.com",
  "address": "Av. Principal 123",
  "city": "Quito",
  "items": [{"productId": "metro", "quantity": 1}]
}
```

El servidor calcula los importes desde el catálogo. Las pruebas forzadas de `/api/lab/orders` crean datos ficticios. Para forzar resultados en el endpoint de compras se requiere `-Dbikestore.testMode=true`, como hace el script de integración.

La aplicación escucha solo en el equipo local. Es una demostración académica sin autenticación de usuarios, inventario físico ni pasarela bancaria real.

