package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.data.annotation.Id;
import org.springframework.data.map.repository.config.EnableMapRepositories;
import org.springframework.data.repository.CrudRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

/**
 * A plain Spring Boot app with no LSD code: one MVC endpoint that checks stock through a
 * {@link RestTemplate}, prices the order through a {@link RestClient}, saves it through a Spring Data
 * repository and, with {@code shop.events.enabled}, announces it on Kafka for its own listener.
 */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration
@EnableMapRepositories(considerNestedRepositories = true)
public class ShopApp {
    public static final String TOPIC = "orders.placed";


    public static class PlacedOrder {
        @Id
        private String id;

        private String sku;
        private int quantity;

        public PlacedOrder() {}

        PlacedOrder(String id, String sku, int quantity) {
            this.id = id;
            this.sku = sku;
            this.quantity = quantity;
        }

        public String getId() {
            return id;
        }

        public String getSku() {
            return sku;
        }

        public int getQuantity() {
            return quantity;
        }

        @Override
        public String toString() {
            return "PlacedOrder(id=" + id + ", sku=" + sku + ", quantity=" + quantity + ")";
        }
    }

    public interface OrderRepository extends CrudRepository<PlacedOrder, String> {}

    @RestController
    static class Orders {
        record OrderRequest(String sku, int quantity) {}

        private final RestClient pricing;
        private final RestTemplate inventory;
        private final String inventoryUrl;
        private final OrderRepository orders;
        private final ObjectProvider<OrderEvents> events;

        Orders(
                RestClient.Builder clients,
                RestTemplateBuilder templates,
                @Value("${shop.pricing.url}") String pricingUrl,
                @Value("${shop.inventory.url}") String inventoryUrl,
                OrderRepository orders,
                ObjectProvider<OrderEvents> events) {
            this.pricing = clients.baseUrl(pricingUrl).build();
            this.inventory = templates.build();
            this.inventoryUrl = inventoryUrl;
            this.orders = orders;
            this.events = events;
        }

        @PostMapping("/orders/{sku}")
        ResponseEntity<Map<String, Object>> place(@PathVariable("sku") String sku, @RequestBody OrderRequest order) {
            Map<?, ?> stock = inventory.getForObject(inventoryUrl + "/stock/" + sku, Map.class);
            Map<?, ?> quote = pricing.post().uri("/quotes").body(Map.of("sku", sku, "quantity", order.quantity()))
                    .retrieve().body(Map.class);
            PlacedOrder placed = orders.save(new PlacedOrder("order-1", sku, order.quantity()));
            events.ifAvailable(e -> e.placed(placed));
            return ResponseEntity.status(201).body(Map.of("sku", sku, "total", quote.get("total"), "inStock", stock.get("available")));
        }
    }

    @Component
    @ConditionalOnProperty(name = "shop.events.enabled", havingValue = "true")
    static class OrderEvents {
        private final KafkaTemplate<String, String> kafka;

        OrderEvents(KafkaTemplate<String, String> kafka) {
            this.kafka = kafka;
        }

        void placed(PlacedOrder order) {
            try {
                kafka.send(TOPIC, order.getSku(), "{\"orderId\":\"" + order.getId() + "\",\"sku\":\"" + order.getSku() + "\"}")
                        .get(30, TimeUnit.SECONDS);
            } catch (Exception e) {
                throw new IllegalStateException("could not announce " + order.getId(), e);
            }
        }
    }

    /**
     * Counted down when this app's listener has handled an order event. A bean, so each fixture's
     * context has its own and a listener left running in another cached context cannot release it.
     */
    @Component
    @ConditionalOnProperty(name = "shop.events.enabled", havingValue = "true")
    public static class Handled {
        private final CountDownLatch latch = new CountDownLatch(1);

        void countDown() {
            latch.countDown();
        }

        public boolean await(long timeout, TimeUnit unit) throws InterruptedException {
            return latch.await(timeout, unit);
        }
    }

    @Component
    @ConditionalOnProperty(name = "shop.events.enabled", havingValue = "true")
    static class OrderListener {
        private final OrderRepository orders;
        private final Handled handled;

        OrderListener(OrderRepository orders, Handled handled) {
            this.orders = orders;
            this.handled = handled;
        }

        @KafkaListener(topics = TOPIC, groupId = "shop")
        void on(String event) {
            orders.findById("order-1");
            handled.countDown();
        }
    }
}
