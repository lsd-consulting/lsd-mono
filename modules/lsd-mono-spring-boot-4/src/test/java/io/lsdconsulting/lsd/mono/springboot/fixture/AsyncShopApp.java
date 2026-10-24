package io.lsdconsulting.lsd.mono.springboot.fixture;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.core.task.TaskDecorator;
import org.springframework.data.map.repository.config.EnableMapRepositories;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

/**
 * A plain Spring Boot app with no LSD code that hands its work to other threads: it prices an order
 * on a pool of its own (with its own {@link TaskDecorator}) through a {@link RestClient}, and saves it
 * in an {@link Async} method on Boot's task executor.
 */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration
@EnableAsync
@EnableMapRepositories(considerNestedRepositories = true)
public class AsyncShopApp {
    /** The app's own pool and decorator, as an app might carry a tenant or MDC onto it. */
    @Bean
    ThreadPoolTaskExecutor pricingPool() {
        ThreadPoolTaskExecutor pool = new ThreadPoolTaskExecutor();
        pool.setCorePoolSize(2);
        pool.setThreadNamePrefix("pricing-");
        pool.setTaskDecorator(Tenant.DECORATOR);
        return pool;
    }

    static final class Tenant {
        static final ThreadLocal<String> CURRENT = new ThreadLocal<>();
        static final TaskDecorator DECORATOR = task -> () -> {
            CURRENT.set("acme");
            try {
                task.run();
            } finally {
                CURRENT.remove();
            }
        };

        private Tenant() {}
    }

    /** Holds each order until the other has arrived too, so both are being served at once. */
    @Component
    public static class BothIn {
        private final CyclicBarrier barrier = new CyclicBarrier(2);

        void await() {
            try {
                barrier.await(10, TimeUnit.SECONDS);
            } catch (Exception e) {
                throw new IllegalStateException("the other order never arrived", e);
            }
        }
    }

    @Component
    public static class Fulfilment {
        private final ShopApp.OrderRepository orders;

        Fulfilment(ShopApp.OrderRepository orders) {
            this.orders = orders;
        }

        @Async("applicationTaskExecutor")
        public CompletableFuture<ShopApp.PlacedOrder> fulfil(String sku) {
            return CompletableFuture.completedFuture(orders.save(new ShopApp.PlacedOrder("order-" + sku, sku, 1)));
        }
    }

    @RestController
    static class Orders {
        private final RestClient pricing;
        private final ThreadPoolTaskExecutor pool;
        private final Fulfilment fulfilment;
        private final BothIn bothIn;

        Orders(
                RestClient.Builder clients,
                @Value("${shop.pricing.url}") String pricingUrl,
                @Qualifier("pricingPool") ThreadPoolTaskExecutor pool,
                Fulfilment fulfilment,
                BothIn bothIn) {
            this.pricing = clients.baseUrl(pricingUrl).build();
            this.pool = pool;
            this.fulfilment = fulfilment;
            this.bothIn = bothIn;
        }

        @PostMapping("/orders/{sku}")
        ResponseEntity<Map<String, Object>> place(@PathVariable("sku") String sku) throws Exception {
            bothIn.await();
            CompletableFuture<Map<?, ?>> quote = pool.submitCompletable(() -> pricing.post()
                    .uri("/quotes")
                    .header("X-Tenant", Tenant.CURRENT.get())
                    .body(Map.of("sku", sku, "quantity", 1))
                    .retrieve()
                    .body(Map.class));
            ShopApp.PlacedOrder placed = fulfilment.fulfil(sku).get(10, TimeUnit.SECONDS);
            return ResponseEntity.status(201)
                    .body(Map.of("orderId", placed.getId(), "total", quote.get(10, TimeUnit.SECONDS).get("total")));
        }
    }
}
