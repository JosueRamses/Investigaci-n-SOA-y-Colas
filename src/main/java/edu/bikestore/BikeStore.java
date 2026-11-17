package edu.bikestore;

import com.sun.net.httpserver.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.apache.activemq.artemis.api.core.client.ClientMessage;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/** BikeStore Async: tienda, API, bróker y consumidores independientes. */
public class BikeStore {
    static final ObjectMapper json = new ObjectMapper();
    static Broker broker;
    static MailService mail;
    static OrderStore store;
    static final boolean TEST_MODE = Boolean.getBoolean("bikestore.testMode");
    static final ExecutorService workers = Executors.newFixedThreadPool(2);
    static final ExecutorService http = Executors.newThreadPerTaskExecutor(
        Thread.ofVirtual().name("OrderProducer-http-", 0).factory());

    static void log(String id, String event) {
        System.out.printf("timestamp=%s thread=%s pedidoId=%s %s%n",
            Instant.now(), Thread.currentThread().getName(), id, event);
    }

    static void event(String id, String status, String payment, String email, int attempts, String detail) throws Exception {
        store.event(id, status, payment, email, attempts, detail);
        log(id, detail);
    }

    static final class PaymentWorker implements Runnable {
        public void run() {
            Thread.currentThread().setName("PaymentWorker");
            try (var consumer = broker.consumer("orders")) {
                while (!Thread.currentThread().isInterrupted()) {
                    ClientMessage received = consumer.receive(500);
                    if (received == null) continue;
                    ObjectNode message = (ObjectNode) json.readTree(received.getBodyBuffer().readString());
                    String id = message.path("pedidoId").asText();
                    ObjectNode saved = store.get(id);
                    boolean success = saved != null && saved.path("paymentStatus").asText().equals("PAID");
                    int completedAttempts = saved == null ? 0 : saved.path("attempts").asInt();
                    for (int attempt = completedAttempts + 1; !success && attempt <= 4; attempt++) {
                        event(id, "PROCESSING", "PENDING", null, attempt, "PAYMENT_ATTEMPT intento=" + attempt);
                        Thread.sleep(500);
                        String mode = message.path("simulation").asText("RANDOM");
                        boolean fails = mode.equals("FAIL") ||
                            (mode.equals("RANDOM") && ThreadLocalRandom.current().nextBoolean());
                        if (!fails) {
                            success = true;
                            event(id, "PAID", "PAID", "PENDING", attempt, "PAYMENT_PAID");
                        } else {
                            log(id, "PAYMENT_FAILED intento=" + attempt);
                            if (attempt < 4) {
                                long delay = 250L * (1L << (attempt - 1));
                                event(id, "RETRYING", "PENDING", null, attempt,
                                    "PAYMENT_RETRY reintento=" + attempt + " esperaMs=" + delay);
                                Thread.sleep(delay);
                            }
                        }
                    }
                    if (success) {
                        message.put("paymentStatus", "PAID").put("status", "PAID");
                        broker.publish("payments.paid", json.writeValueAsString(message));
                    } else {
                        message.put("paymentStatus", "FAILED").put("status", "DLQ").put("emailStatus", "NOT_SENT").put("attempts", 4)
                            .put("reason", "PAYMENT_RETRIES_EXHAUSTED").put("failedAt", Instant.now().toString());
                        broker.publish("orders.dlq", json.writeValueAsString(message));
                    }
                    received.acknowledge();
                    broker.commit();
                    if (!success) event(id, "DLQ", "FAILED", "NOT_SENT", 4, "DEAD_LETTER_QUEUE attempts=4");
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            catch (Exception e) { log("SYSTEM", "PAYMENT_WORKER_ERROR " + e); }
            finally { broker.closeSession(); }
        }
    }

    static final class EmailWorker implements Runnable {
        public void run() {
            Thread.currentThread().setName("EmailWorker");
            try (var consumer = broker.consumer("payments.paid")) {
                while (!Thread.currentThread().isInterrupted()) {
                    ClientMessage received = consumer.receive(500);
                    if (received == null) continue;
                    ObjectNode message = (ObjectNode) json.readTree(received.getBodyBuffer().readString());
                    String id = message.path("pedidoId").asText();
                    if (!message.path("paymentStatus").asText().equals("PAID")) {
                        log(id, "EMAIL_SKIPPED pago_no_confirmado");
                        received.acknowledge(); broker.commit(); continue;
                    }
                    try {
                        mail.send(message);
                    } catch (Exception e) {
                        event(id, "EMAIL_RETRY", "PAID", "RETRYING", -1, "EMAIL_RETRY entrega_local_pendiente");
                        broker.rollback(); Thread.sleep(1000); continue;
                    }
                    event(id, "EMAIL_LOCAL", "PAID", "LOCAL_DELIVERED", -1,
                        "EMAIL_DELIVERED smtp=local destinatario=" + message.path("email").asText());
                    received.acknowledge(); broker.commit();
                }
            } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            catch (Exception e) { log("SYSTEM", "EMAIL_WORKER_ERROR " + e); }
            finally { broker.closeSession(); }
        }
    }

    static void respond(HttpExchange exchange, int code, Object body) throws IOException {
        byte[] bytes = json.writeValueAsBytes(body);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(code, bytes.length);
        try (var output = exchange.getResponseBody()) { output.write(bytes); }
    }

    static Map<String, String> publishOrder(ObjectNode order, String simulation, boolean demo) throws Exception {
        String id = UUID.randomUUID().toString();
        order.put("pedidoId", id).put("timestamp", Instant.now().toString()).put("simulation", simulation)
            .put("status", "PENDING").put("paymentStatus", "PENDING").put("emailStatus", "PENDING").put("attempts", 0);
        if (demo) order.put("demo", true);
        order.putArray("events");
        store.create(order);
        try {
            broker.publish("orders", json.writeValueAsString(order));
            broker.commit();
        } catch (Exception e) {
            event(id, "PUBLISH_FAILED", "PENDING", "NOT_SENT", 0, "ORDER_PUBLISH_FAILED");
            throw e;
        }
        event(id, null, null, null, -1, "ORDER_ACCEPTED queue=orders");
        return Map.of("pedidoId", id, "status", "PENDING");
    }

    static final class OrderProducer implements HttpHandler {
        public void handle(HttpExchange exchange) throws IOException {
            try {
                String path = exchange.getRequestURI().getPath();
                String method = exchange.getRequestMethod();
                if (path.equals("/api/catalog") && method.equals("GET")) {
                    respond(exchange, 200, Catalog.PRODUCTS);
                } else if (path.equals("/api/config") && method.equals("GET")) {
                    respond(exchange, 200, Map.of("mailMode", "LOCAL", "testMode", TEST_MODE, "currency", "USD"));
                } else if ((path.equals("/api/orders") || path.equals("/api/lab/orders")) && method.equals("POST")) {
                    byte[] bytes = exchange.getRequestBody().readNBytes(16385);
                    if (bytes.length > 16384) throw new IllegalArgumentException("Pedido demasiado grande");
                    JsonNode input = json.readTree(bytes);
                    boolean demo = path.equals("/api/lab/orders");
                    String simulation;
                    ObjectNode order;
                    if (demo) {
                        if (input == null || !input.isObject()) throw new IllegalArgumentException("Prueba invalida");
                        simulation = Catalog.text(input, "scenario", 1, 10);
                        if (!simulation.matches("SUCCESS|FAIL")) throw new IllegalArgumentException("Escenario de prueba invalido");
                        ObjectNode sample = json.createObjectNode().put("customerName", "Cliente de demostracion")
                            .put("email", "demo@bikestore.local").put("address", "Av. de demostracion 123").put("city", "Quito");
                        sample.putArray("items").addObject().put("productId", "metro").put("quantity", 1);
                        order = Catalog.order(sample);
                    } else {
                        order = Catalog.order(input);
                        simulation = input.path("simulation").asText("RANDOM");
                        if ((!TEST_MODE && !simulation.equals("RANDOM")) || !simulation.matches("RANDOM|SUCCESS|FAIL"))
                            throw new IllegalArgumentException("Las opciones de prueba no estan habilitadas en la tienda");
                    }
                    respond(exchange, 202, publishOrder(order, simulation, demo));
                } else if (path.startsWith("/api/orders/") && method.equals("GET")) {
                    String[] segments = path.substring("/api/orders/".length()).split("/");
                    String id = segments[0];
                    if (!id.matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Identificador invalido");
                    ObjectNode order = store.get(id);
                    if (order == null) { respond(exchange, 404, Map.of("error", "Pedido no encontrado")); return; }
                    if (segments.length == 1) respond(exchange, 200, order);
                    else if (segments.length == 2 && segments[1].equals("email")) {
                        Path file = mail.mailbox.resolve(id + ".eml");
                        if (!Files.exists(file)) respond(exchange, 404, Map.of("error", "La confirmacion aun no esta disponible"));
                        else {
                            try (var source = Files.newInputStream(file)) {
                                var email = new jakarta.mail.internet.MimeMessage((jakarta.mail.Session) null, source);
                                respond(exchange, 200, Map.of("subject", email.getSubject(), "to", order.path("email").asText(),
                                    "body", email.getContent().toString(), "delivery", "LOCAL"));
                            }
                        }
                    } else respond(exchange, 404, Map.of("error", "Ruta no encontrada"));
                } else if (path.equals("/api/dlq") && method.equals("GET")) {
                    var messages = json.createArrayNode();
                    for (String message : broker.browse("orders.dlq")) messages.add(json.readTree(message));
                    respond(exchange, 200, messages);
                } else respond(exchange, 404, Map.of("error", "Ruta no encontrada"));
            } catch (IllegalArgumentException | com.fasterxml.jackson.core.JsonProcessingException e) {
                respond(exchange, 400, Map.of("error", e instanceof IllegalArgumentException ? e.getMessage() : "JSON invalido"));
            } catch (Exception e) {
                log("SYSTEM", "API_ERROR " + e.getClass().getSimpleName());
                respond(exchange, 503, Map.of("error", "No se pudo procesar la solicitud. Intenta nuevamente."));
            } finally { broker.closeSession(); exchange.close(); }
        }
    }

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8080;
        store = new OrderStore();
        broker = new Broker();
        mail = new MailService();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/api/", new OrderProducer());
        server.createContext("/", exchange -> {
            try {
                String path = exchange.getRequestURI().getPath();
                String file = switch (path) {
                    case "/", "/index.html" -> "index.html";
                    case "/app.js" -> "app.js";
                    case "/styles.css" -> "styles.css";
                    case "/laboratorio" -> "laboratorio.html";
                    case "/laboratorio.js" -> "laboratorio.js";
                    default -> null;
                };
                if (file == null) { respond(exchange, 404, Map.of("error", "Pagina no encontrada")); return; }
                try (var resource = BikeStore.class.getResourceAsStream("/web/" + file)) {
                    if (resource == null) { respond(exchange, 404, Map.of("error", "Recurso no encontrado")); return; }
                    byte[] bytes = resource.readAllBytes();
                    String type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "application/javascript" : "text/html";
                    exchange.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
                    exchange.getResponseHeaders().set("Cache-Control", "no-store");
                    exchange.sendResponseHeaders(200, bytes.length);
                    exchange.getResponseBody().write(bytes);
                }
            } finally { exchange.close(); }
        });
        server.setExecutor(http);
        workers.submit(new PaymentWorker());
        workers.submit(new EmailWorker());
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.stop(0); workers.shutdownNow(); http.shutdownNow();
            try { workers.awaitTermination(5, TimeUnit.SECONDS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            mail.close();
            try { broker.close(); } catch (Exception e) { System.err.println(e.getMessage()); }
        }));
        server.start();
        System.out.println("BikeStore Async v1.0: http://localhost:" + port);
        System.out.println("Catalogo, carrito, pedidos y buzon local | Apache Artemis persistente | JDK 21");
    }
}
