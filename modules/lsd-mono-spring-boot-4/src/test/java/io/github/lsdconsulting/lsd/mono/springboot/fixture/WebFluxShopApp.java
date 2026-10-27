package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.data.map.repository.config.EnableMapRepositories;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
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
 * service that answers 404 for one it does not know. With {@code shop.events.enabled} it also books
 * orders: it saves each through a Spring Data repository and announces it on Kafka, both after
 * hopping onto a worker pool.
 */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration
@EnableMapRepositories(considerNestedRepositories = true)
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

    /** Holds each booking until the other has arrived too, so both are being served at once. */
    @Component
    @ConditionalOnProperty(name = "shop.events.enabled", havingValue = "true")
    public static class BothIn {
        private final CyclicBarrier barrier = new CyclicBarrier(2);

        Object await() throws Exception {
            return barrier.await(10, TimeUnit.SECONDS);
        }
    }

    @RestController
    @ConditionalOnProperty(name = "shop.events.enabled", havingValue = "true")
    static class Bookings {
        private final ShopApp.OrderRepository orders;
        private final KafkaTemplate<String, String> kafka;
        private final BothIn bothIn;

        Bookings(ShopApp.OrderRepository orders, KafkaTemplate<String, String> kafka, BothIn bothIn) {
            this.orders = orders;
            this.kafka = kafka;
            this.bothIn = bothIn;
        }

        @PostMapping("/bookings/{sku}")
        Mono<ResponseEntity<Map<String, Object>>> book(@PathVariable("sku") String sku) {
            return Mono.fromCallable(bothIn::await)
                    .subscribeOn(Schedulers.boundedElastic())
                    .delayElement(Duration.ofMillis(5))
                    .publishOn(Schedulers.boundedElastic())
                    .map(ignored -> orders.save(new ShopApp.PlacedOrder("order-" + sku, sku, 1)))
                    .map(placed -> {
                        try {
                            kafka.send(ShopApp.TOPIC, sku, "{\"orderId\":\"" + placed.getId() + "\"}")
                                    .get(30, TimeUnit.SECONDS);
                        } catch (Exception e) {
                            throw new IllegalStateException("could not announce " + placed.getId(), e);
                        }
                        return ResponseEntity.status(201).body(Map.<String, Object>of("orderId", placed.getId()));
                    });
        }
    }
}
