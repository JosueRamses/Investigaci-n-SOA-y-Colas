package edu.bikestore;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;

/** Pedidos y seguimiento persistidos mediante reemplazo atómico de archivos JSON. */
public final class OrderStore {
    final Path directory;
    final Map<String, ObjectNode> orders = new HashMap<>();

    OrderStore() throws Exception {
        directory = Path.of(System.getProperty("bikestore.data", "data"), "orders");
        Files.createDirectories(directory);
        try (var files = Files.list(directory)) {
            for (Path path : files.filter(p -> p.toString().endsWith(".json")).toList()) {
                ObjectNode order = (ObjectNode) BikeStore.json.readTree(Files.readString(path));
                orders.put(order.path("pedidoId").asText(), order);
            }
        }
    }

    synchronized void create(ObjectNode order) throws Exception {
        save(order);
        orders.put(order.path("pedidoId").asText(), order.deepCopy());
    }

    synchronized ObjectNode get(String id) { return orders.containsKey(id) ? orders.get(id).deepCopy() : null; }

    synchronized void event(String id, String status, String payment, String email, int attempts, String detail) throws Exception {
        ObjectNode current = orders.get(id);
        if (current == null) return; // Compatibilidad con mensajes de la primera versión.
        ObjectNode updated = current.deepCopy();
        if (status != null) updated.put("status", status);
        if (payment != null) updated.put("paymentStatus", payment);
        if (email != null) updated.put("emailStatus", email);
        if (attempts >= 0) updated.put("attempts", attempts);
        updated.withArray("events").addObject().put("timestamp", java.time.Instant.now().toString())
            .put("detail", detail).put("thread", Thread.currentThread().getName());
        save(updated);
        orders.put(id, updated);
    }

    void save(ObjectNode order) throws Exception {
        String id = order.path("pedidoId").asText();
        Path target = directory.resolve(id + ".json");
        Path temp = directory.resolve(id + ".tmp");
        Files.writeString(temp, BikeStore.json.writeValueAsString(order));
        try { Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (AtomicMoveNotSupportedException e) { Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING); }
    }
}
