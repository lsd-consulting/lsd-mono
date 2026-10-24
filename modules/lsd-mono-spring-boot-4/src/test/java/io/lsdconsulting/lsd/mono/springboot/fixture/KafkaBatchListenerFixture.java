package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.stereotype.Component;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The shop with a batch {@code @KafkaListener} on Spring Boot's own container factory
 * ({@code spring.kafka.listener.type=batch}): three orders arrive on {@code orders.placed} and the
 * shop takes them as one {@code List<ConsumerRecord>}, saving them in one call. The listener starts
 * once all three are on the topic, so they come in a single batch. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = {ShopApp.class, KafkaBatchListenerFixture.Dispatch.class},
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "spring.application.name=shop",
            "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}",
            "spring.kafka.consumer.auto-offset-reset=earliest",
            "spring.kafka.listener.type=batch"
        })
public class KafkaBatchListenerFixture {
    @TestConfiguration(proxyBeanMethods = false)
    @Import(Batches.class)
    static class Dispatch {
        @Component
        static class OrderBatchListener {
            private final ShopApp.OrderRepository orders;
            private final Batches batches;

            OrderBatchListener(ShopApp.OrderRepository orders, Batches batches) {
                this.orders = orders;
                this.batches = batches;
            }

            @KafkaListener(id = "dispatch", topics = ShopApp.TOPIC, groupId = "dispatch", autoStartup = "false")
            void on(List<ConsumerRecord<String, String>> records) {
                orders.saveAll(records.stream()
                        .map(r -> new ShopApp.PlacedOrder("order-" + r.offset(), r.key(), 1))
                        .toList());
                batches.handled(records.size());
            }
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
        registry.add("shop.inventory.url", () -> Stubs.url(Stubs.INVENTORY));
    }

    @Autowired
    KafkaTemplate<String, String> kafka;

    @Autowired
    KafkaListenerEndpointRegistry listeners;

    @Autowired
    Batches batches;

    @Test
    void dispatchesThreeOrdersInOneBatch() throws Exception {
        for (String sku : List.of("lamp-01", "desk-02", "chair-03")) {
            kafka.send(ShopApp.TOPIC, sku, "{\"sku\":\"" + sku + "\"}").get(30, TimeUnit.SECONDS);
        }
        listeners.getListenerContainer("dispatch").start();

        assertThat(batches.await(3, 30, TimeUnit.SECONDS)).isTrue();
        assertThat(batches.sizes()).containsExactly(3);
    }
}
