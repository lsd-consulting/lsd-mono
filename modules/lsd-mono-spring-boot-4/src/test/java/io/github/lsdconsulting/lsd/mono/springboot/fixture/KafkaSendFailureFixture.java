package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The shop with its Kafka events on, but a producer that refuses any record over 32 bytes, so
 * announcing an order fails and the order request with it. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = ShopApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "spring.application.name=shop",
            "shop.events.enabled=true",
            "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}",
            "spring.kafka.producer.properties[max.request.size]=32"
        })
public class KafkaSendFailureFixture {
    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
        registry.add("shop.inventory.url", () -> Stubs.url(Stubs.INVENTORY));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    @Test
    void cannotAnnounceAnOrder() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/orders/lamp-01"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"sku\":\"lamp-01\",\"quantity\":2}"))
                .build();
        assertThat(CLIENT.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(500);
    }
}
