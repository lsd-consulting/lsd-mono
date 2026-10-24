package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

/**
 * A shop that builds every HTTP client itself, as beans, instead of from Spring Boot's builders: a
 * {@code RestClient} from {@code RestClient.builder()}, a {@code RestTemplate} made with
 * {@code new}, and its own {@code RestTemplateBuilder} (so Boot backs off its own). Nothing here
 * knows about LSD.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = OwnClientsFixture.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.application.name=shop")
public class OwnClientsFixture {
    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        @Bean
        RestClient pricing(@Value("${shop.pricing.url}") String url) {
            return RestClient.builder().baseUrl(url).build();
        }

        @Bean
        RestTemplate inventory() {
            return new RestTemplate();
        }

        @Bean
        RestTemplateBuilder restTemplateBuilder() {
            return new RestTemplateBuilder();
        }

        @RestController
        static class Orders {
            private final RestClient pricing;
            private final RestTemplate inventory;
            private final RestTemplate tracking;
            private final String inventoryUrl;

            Orders(
                    RestClient pricing,
                    RestTemplate inventory,
                    RestTemplateBuilder builder,
                    @Value("${shop.inventory.url}") String inventoryUrl,
                    @Value("${shop.tracking.url}") String trackingUrl) {
                this.pricing = pricing;
                this.inventory = inventory;
                this.tracking = builder.rootUri(trackingUrl).build();
                this.inventoryUrl = inventoryUrl;
            }

            @PostMapping("/orders/{sku}")
            ResponseEntity<Map<String, Object>> place(@PathVariable("sku") String sku) {
                Map<?, ?> stock = inventory.getForObject(inventoryUrl + "/stock/" + sku, Map.class);
                Map<?, ?> price = pricing.post()
                        .uri("/quotes")
                        .body(Map.of("sku", sku, "quantity", 1))
                        .retrieve()
                        .body(Map.class);
                boolean tracked;
                try {
                    tracking.getForObject("/parcels/" + sku, Map.class);
                    tracked = true;
                } catch (HttpClientErrorException.NotFound e) {
                    tracked = false;
                }
                return ResponseEntity.status(201)
                        .body(Map.of("sku", sku, "available", stock.get("available"), "total", price.get("total"), "tracked", tracked));
            }
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
        registry.add("shop.inventory.url", () -> Stubs.url(Stubs.INVENTORY));
        registry.add("shop.tracking.url", () -> Stubs.url(Stubs.TRACKING));
    }

    @LocalServerPort
    int port;

    @Test
    void placesAnOrderThroughClientsItBuiltItself() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/orders/lamp-01"))
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
        HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(201);
        assertThat(JsonParserFactory.getJsonParser().parseMap(response.body())).containsEntry("tracked", false).containsKey("total");
    }
}
