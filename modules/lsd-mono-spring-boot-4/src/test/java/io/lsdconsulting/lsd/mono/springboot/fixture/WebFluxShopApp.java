package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;

import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * A plain reactive Spring Boot app with no LSD code: an annotated WebFlux controller that prices an
 * order through Boot's {@link WebClient.Builder}, hops schedulers, then checks stock through a
 * {@link WebClient} the app builds itself; and a router function that tracks an order through a
 * service that answers 404 for one it does not know.
 */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration
public class WebFluxShopApp {
    /** Built by hand, not from Boot's builder: the starter still draws its calls. */
    @Bean
    WebClient inventory(@Value("${shop.inventory.url}") String url) {
        return WebClient.builder().baseUrl(url).build();
    }

    @Bean
    RouterFunction<ServerResponse> tracking(WebClient.Builder clients, @Value("${shop.tracking.url}") String url) {
        WebClient tracking = clients.baseUrl(url).build();
        return route(GET("/orders/{id}/tracking"), request -> tracking.get()
                .uri("/parcels/{id}", request.pathVariable("id"))
                .retrieve()
                .bodyToMono(Map.class)
                .flatMap(parcel -> ServerResponse.ok().bodyValue(parcel))
                .onErrorResume(
                        WebClientResponseException.NotFound.class,
                        e -> ServerResponse.status(404).bodyValue(Map.of("error", "no such order"))));
    }

    @RestController
    static class Orders {
        record OrderRequest(String sku, int quantity) {}

        private final WebClient pricing;
        private final WebClient inventory;

        Orders(WebClient.Builder clients, @Value("${shop.pricing.url}") String pricingUrl, WebClient inventory) {
            this.pricing = clients.baseUrl(pricingUrl).build();
            this.inventory = inventory;
        }

        @PostMapping("/orders/{sku}")
        Mono<ResponseEntity<Map<String, Object>>> place(@PathVariable("sku") String sku, @RequestBody Mono<OrderRequest> order) {
            return order.flatMap(o -> pricing.post()
                            .uri("/quotes")
                            .bodyValue(Map.of("sku", sku, "quantity", o.quantity()))
                            .retrieve()
                            .bodyToMono(Map.class))
                    // Off the event loop and onto a timer and a worker pool before the next call.
                    .delayElement(Duration.ofMillis(5))
                    .publishOn(Schedulers.boundedElastic())
                    .flatMap(quote -> inventory.get()
                            .uri("/stock/{sku}", sku)
                            .retrieve()
                            .bodyToMono(Map.class)
                            .map(stock -> ResponseEntity.status(201)
                                    .body(Map.<String, Object>of(
                                            "sku", sku, "total", quote.get("total"), "inStock", stock.get("available")))));
        }
    }
}
