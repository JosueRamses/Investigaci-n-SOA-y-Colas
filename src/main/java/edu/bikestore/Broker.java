package edu.bikestore;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.apache.activemq.artemis.api.core.*;
import org.apache.activemq.artemis.api.core.client.*;
import org.apache.activemq.artemis.core.config.impl.ConfigurationImpl;
import org.apache.activemq.artemis.core.server.embedded.EmbeddedActiveMQ;
import org.apache.activemq.artemis.core.server.JournalType;
import org.apache.activemq.artemis.core.settings.impl.AddressSettings;

/** Bróker Apache Artemis real, embebido y persistente. Cada hilo tiene su sesión. */
public final class Broker implements AutoCloseable {
    final EmbeddedActiveMQ server;
    final ServerLocator locator;
    final ClientSessionFactory factory;
    final ThreadLocal<ClientSession> sessions = new ThreadLocal<>();

    public Broker() throws Exception {
        String data = Path.of(System.getProperty("bikestore.data", "data")).toAbsolutePath().toString();
        var config = new ConfigurationImpl().setPersistenceEnabled(true).setSecurityEnabled(false)
            .setMaxDiskUsage(99)
            .setJournalType(JournalType.NIO).setJournalDirectory(data + "/journal")
            .setBindingsDirectory(data + "/bindings").setPagingDirectory(data + "/paging")
            .setLargeMessagesDirectory(data + "/large-messages")
            .addAcceptorConfiguration("in-vm", "vm://0");
        config.addAddressSetting("payments.paid", new AddressSettings().setMaxDeliveryAttempts(-1));
        for (String name : List.of("orders", "payments.paid", "orders.dlq")) {
            config.addQueueConfiguration(QueueConfiguration.of(name).setAddress(name)
                .setRoutingType(RoutingType.ANYCAST).setDurable(true));
        }
        server = new EmbeddedActiveMQ().setConfiguration(config);
        server.start();
        locator = ActiveMQClient.createServerLocatorWithoutHA(new TransportConfiguration(
            "org.apache.activemq.artemis.core.remoting.impl.invm.InVMConnectorFactory"));
        factory = locator.createSessionFactory();
    }

    ClientSession session() throws Exception {
        ClientSession session = sessions.get();
        if (session == null) {
            session = factory.createSession(false, false, false);
            session.start();
            sessions.set(session);
        }
        return session;
    }

    void publish(String queue, String json) throws Exception {
        var session = session();
        try (ClientProducer producer = session.createProducer(queue)) {
            var message = session.createMessage(true);
            message.getBodyBuffer().writeString(json);
            producer.send(message);
        }
    }

    ClientConsumer consumer(String queue) throws Exception { return session().createConsumer(queue); }
    void commit() throws Exception { session().commit(); }
    void rollback() throws Exception { session().rollback(); }
    void closeSession() {
        ClientSession s = sessions.get();
        if (s != null) { try { s.close(); } catch (Exception ignored) {} sessions.remove(); }
    }

    List<String> browse(String queue) throws Exception {
        List<String> messages = new ArrayList<>();
        try (ClientSession session = factory.createSession();
             ClientConsumer browser = session.createConsumer(queue, null, true)) {
            session.start();
            ClientMessage message;
            while ((message = browser.receive(150)) != null) messages.add(message.getBodyBuffer().readString());
        }
        return messages;
    }

    public void close() throws Exception { factory.close(); locator.close(); server.stop(); }
}
