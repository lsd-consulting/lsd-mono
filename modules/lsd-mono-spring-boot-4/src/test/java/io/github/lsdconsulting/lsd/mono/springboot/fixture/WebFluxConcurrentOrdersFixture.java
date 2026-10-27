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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * Two orders placed at once in one test, against slow pricing so they overlap: each request's calls
 * hop schedulers while the other is in flight. Launched by StarterEndToEndTest; not a sample report.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = WebFluxShopApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "spring.main.web-application-type=reactive"})
public class WebFluxConcurrentOrdersFixture {
    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.SLOW_PRICING));
        registry.add("shop.inventory.url", () -> Stubs.url(Stubs.INVENTORY));
        registry.add("shop.tracking.url", () -> Stubs.url(Stubs.TRACKING));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    @Test
    void placesTwoOrdersAtOnce() {
        List<CompletableFuture<HttpResponse<String>>> orders = List.of("lamp-01", "desk-02").stream()
                .map(sku -> CLIENT.sendAsync(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/orders/" + sku))
                                .header("Content-Type", "application/json")
                                .POST(HttpRequest.BodyPublishers.ofString("{\"sku\":\"" + sku + "\",\"quantity\":1}"))
                                .build(),
                        HttpResponse.BodyHandlers.ofString()))
                .toList();
        for (CompletableFuture<HttpResponse<String>> order : orders) {
            assertThat(order.join().statusCode()).isEqualTo(201);
        }
    }
}
