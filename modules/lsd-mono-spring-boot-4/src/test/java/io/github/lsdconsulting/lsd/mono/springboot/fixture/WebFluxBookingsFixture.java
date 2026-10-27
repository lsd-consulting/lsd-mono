package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Two bookings at once on the reactive shop: each saves and announces its order on a worker pool. */
@Tag("lsd-fixture")
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = WebFluxShopApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "spring.application.name=shop",
            "spring.main.web-application-type=reactive",
            "shop.events.enabled=true",
            "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}"
        })
public class WebFluxBookingsFixture {
    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
        registry.add("shop.inventory.url", () -> Stubs.url(Stubs.INVENTORY));
        registry.add("shop.tracking.url", () -> Stubs.url(Stubs.TRACKING));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    @Test
    void booksTwoOrdersAtOnce() {
        List<CompletableFuture<HttpResponse<String>>> bookings = List.of("lamp-01", "desk-02").stream()
                .map(sku -> CLIENT.sendAsync(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/bookings/" + sku))
                                .POST(HttpRequest.BodyPublishers.noBody())
                                .build(),
                        HttpResponse.BodyHandlers.ofString()))
                .toList();
        for (CompletableFuture<HttpResponse<String>> booking : bookings) {
            assertThat(booking.join().statusCode()).isEqualTo(201);
        }
    }
}
