package edu.bikestore;

import com.icegreen.greenmail.util.GreenMail;
import com.icegreen.greenmail.util.ServerSetup;
import jakarta.mail.*;
import jakarta.mail.internet.*;
import java.nio.file.*;
import java.util.Properties;

/** Entrega SMTP real a un servidor local de prueba, sin enviar a Internet. */
public final class MailService implements AutoCloseable {
    final GreenMail smtp;
    final Session session;
    final Path mailbox;

    MailService() throws Exception {
        smtp = new GreenMail(new ServerSetup(0, "127.0.0.1", ServerSetup.PROTOCOL_SMTP));
        smtp.setUser("cliente@bikestore.local", "cliente", "cliente");
        smtp.start();
        Properties properties = new Properties();
        properties.setProperty("mail.smtp.host", "127.0.0.1");
        properties.setProperty("mail.smtp.port", Integer.toString(smtp.getSmtp().getPort()));
        properties.setProperty("mail.smtp.connectiontimeout", "5000");
        properties.setProperty("mail.smtp.timeout", "5000");
        session = Session.getInstance(properties);
        mailbox = Path.of(System.getProperty("bikestore.data", "data"), "emails");
        Files.createDirectories(mailbox);
    }

    void send(com.fasterxml.jackson.databind.node.ObjectNode order) throws Exception {
        String id = order.path("pedidoId").asText();
        String email = order.path("email").asText();
        if (Files.exists(mailbox.resolve(id + ".eml"))) return;
        if (smtp.getUserManager().getUserByEmail(email) == null) smtp.setUser(email, email, "local-test");
        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress("pedidos@bikestore.local"));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress(email, true));
        message.setSubject("Pedido confirmado: " + id, "UTF-8");
        StringBuilder body = new StringBuilder("Hola " + order.path("customerName").asText("cliente") + ",\n\n");
        body.append("Tu pago fue aprobado y tu pedido esta confirmado.\n\nPedido: ").append(id).append("\n\n");
        for (var item : order.withArray("items")) {
            body.append(item.path("quantity").asInt()).append(" x ").append(item.path("name").asText())
                .append(" — $").append(String.format(java.util.Locale.US, "%.2f", item.path("subtotalCents").asInt() / 100.0)).append("\n");
        }
        body.append("\nTotal: $").append(String.format(java.util.Locale.US, "%.2f", order.path("totalCents").asInt() / 100.0))
            .append(" USD\nEntrega: ").append(order.path("address").asText()).append(", ").append(order.path("city").asText())
            .append("\n\nGracias por elegir BikeStore.\n\nConfirmacion de demostracion: pago simulado y correo entregado al buzon local de la aplicacion.");
        message.setText(body.toString(), "UTF-8");
        message.setHeader("X-Pedido-Id", id);
        Transport.send(message);
        boolean received = java.util.Arrays.stream(smtp.getReceivedMessages())
            .anyMatch(receipt -> {
                try { return id.equals(receipt.getHeader("X-Pedido-Id", null)); }
                catch (MessagingException e) { return false; }
            });
        if (!received) throw new MessagingException("El servidor SMTP no confirmo la recepcion");
        try (var output = Files.newOutputStream(mailbox.resolve(id + ".eml"))) { message.writeTo(output); }
    }

    public void close() { smtp.stop(); }
}
