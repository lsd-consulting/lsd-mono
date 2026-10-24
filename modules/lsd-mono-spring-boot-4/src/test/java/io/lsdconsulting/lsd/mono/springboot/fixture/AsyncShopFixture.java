package io.lsdconsulting.lsd.mono.springboot.fixture;

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

/** Two orders placed at once, each handing work to the app's own pool and to an @Async method. */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = AsyncShopApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "spring.task.execution.mode=force"})
public class AsyncShopFixture {
    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    @Test
    void placesTwoOrdersAtOnce() {
        List<CompletableFuture<HttpResponse<String>>> orders = List.of("lamp-01", "desk-02").stream()
                .map(sku -> CLIENT.sendAsync(
                        HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/orders/" + sku))
                                .POST(HttpRequest.BodyPublishers.noBody())
                                .build(),
                        HttpResponse.BodyHandlers.ofString()))
                .toList();
        for (CompletableFuture<HttpResponse<String>> order : orders) {
            assertThat(order.join().statusCode()).isEqualTo(201);
        }
    }
}
