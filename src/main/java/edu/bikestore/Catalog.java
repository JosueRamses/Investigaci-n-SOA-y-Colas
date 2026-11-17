package edu.bikestore;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.List;

/** Precios en centavos: el servidor calcula el total y no confía en el navegador. */
public final class Catalog {
    public record Product(String id, String name, String category, String description,
                          int priceCents, String color, String badge) {}
    static final List<Product> PRODUCTS = List.of(
        new Product("summit", "Summit 29", "Montaña", "Suspensión delantera, cuadro de aluminio y 21 velocidades para explorar nuevos caminos.", 45900, "#f18555", "La favorita"),
        new Product("metro", "Metro City", "Urbana", "Cómoda, ligera y lista para acompañarte en cada recorrido por la ciudad.", 32900, "#51a898", "Para cada día"),
        new Product("velocity", "Velocity Road", "Ruta", "Manillar de ruta, transmisión de 16 velocidades y geometría para llegar más lejos.", 69900, "#7d86cd", "Más kilómetros"),
        new Product("terra", "Terra Trail", "Montaña", "Frenos de disco y neumáticos de gran agarre para disfrutar fuera del asfalto.", 54900, "#c9a75d", "Aventura"),
        new Product("coast", "Coast Classic", "Urbana", "Diseño clásico, postura relajada y una conducción suave para pasear sin prisa.", 38900, "#d688a0", "Sin prisa"),
        new Product("sprint", "Sprint Sport", "Ruta", "Respuesta ágil, cuadro ligero y componentes versátiles para entrenar a tu ritmo.", 82900, "#4894c7", "Rendimiento")
    );

    static Product find(String id) {
        return PRODUCTS.stream().filter(p -> p.id().equals(id)).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Bicicleta no disponible"));
    }

    static ObjectNode order(JsonNode input) {
        if (input == null || !input.isObject()) throw new IllegalArgumentException("Pedido invalido");
        String name = text(input, "customerName", 2, 100);
        String email = text(input, "email", 3, 200);
        if (!email.matches("[^\\s@]+@[^\\s@]+\\.[^\\s@]+")) throw new IllegalArgumentException("Introduce un correo valido");
        String address = text(input, "address", 5, 250);
        String city = text(input, "city", 2, 100);
        JsonNode items = input.get("items");
        if (items == null || !items.isArray() || items.isEmpty() || items.size() > 6)
            throw new IllegalArgumentException("Agrega entre una y seis bicicletas distintas al carrito");
        ObjectNode order = BikeStore.json.createObjectNode();
        var lines = order.putArray("items");
        java.util.Set<String> seen = new java.util.HashSet<>();
        int total = 0;
        StringBuilder summary = new StringBuilder();
        for (JsonNode item : items) {
            Product p = find(text(item, "productId", 1, 30));
            if (!seen.add(p.id())) throw new IllegalArgumentException("Producto duplicado en el carrito");
            JsonNode quantity = item.get("quantity");
            if (quantity == null || !quantity.isIntegralNumber() || !quantity.canConvertToInt()
                || quantity.asInt() < 1 || quantity.asInt() > 5)
                throw new IllegalArgumentException("La cantidad debe estar entre 1 y 5");
            int count = quantity.asInt();
            int subtotal = count * p.priceCents();
            total += subtotal;
            lines.addObject().put("productId", p.id()).put("name", p.name()).put("quantity", count)
                .put("unitPriceCents", p.priceCents()).put("subtotalCents", subtotal);
            if (!summary.isEmpty()) summary.append(", ");
            summary.append(count).append(" x ").append(p.name());
        }
        order.put("customerName", name).put("email", email).put("address", address).put("city", city)
            .put("bike", summary.toString()).put("totalCents", total).put("currency", "USD")
            .put("paymentMethod", "SIMULATED_CARD");
        return order;
    }

    static String text(JsonNode input, String field, int min, int max) {
        JsonNode node = input.get(field);
        if (node == null || !node.isTextual()) throw new IllegalArgumentException("Falta el campo: " + field);
        String value = node.asText().trim();
        if (value.length() < min || value.length() > max || value.chars().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("Revisa el campo: " + field);
        return value;
    }
}
