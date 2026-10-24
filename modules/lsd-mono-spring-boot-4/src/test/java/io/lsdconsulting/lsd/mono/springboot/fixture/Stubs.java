package io.lsdconsulting.lsd.mono.springboot.fixture;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/** Stand-ins for the services the shop calls. */
final class Stubs {
    static final HttpServer PRICING = json("{\"total\":49.0,\"currency\":\"GBP\"}");
    static final HttpServer INVENTORY = json("{\"available\":true}");
    static final HttpServer TRACKING = json(404, "{\"error\":\"unknown parcel\"}");
    /** Pricing that takes its time: one thread serves it, so two orders priced together overlap. */
    static final HttpServer SLOW_PRICING = json(200, "{\"total\":49.0,\"currency\":\"GBP\"}", 300);

    static String url(HttpServer server) {
        return "http://localhost:" + server.getAddress().getPort();
    }

    private static HttpServer json(String body) {
        return json(200, body);
    }

    private static HttpServer json(int status, String body) {
        return json(status, body, 0);
    }

    private static HttpServer json(int status, String body, long delayMillis) {
        try {
            HttpServer server = HttpServer.create(new InetSocketAddress("localhost", 0), 0);
            server.createContext("/", exchange -> {
                exchange.getRequestBody().readAllBytes();
                if (delayMillis > 0) {
                    try {
                        Thread.sleep(delayMillis);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    }
                }
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
            return server;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private Stubs() {}
}
