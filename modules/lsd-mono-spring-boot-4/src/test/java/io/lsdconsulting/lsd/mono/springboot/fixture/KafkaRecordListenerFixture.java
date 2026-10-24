package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.RecordInterceptor;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.stereotype.Component;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The shop with a record {@code @KafkaListener} on Spring Boot's own container factory, which also
 * carries the app's own {@link RecordInterceptor}: three orders are on {@code orders.placed} before
 * the listener starts, so they come in one poll, and the shop saves each as it takes it. Nothing
 * here knows about LSD.
 */
@Tag("lsd-fixture")
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = {ShopApp.class, KafkaRecordListenerFixture.Dispatch.class},
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "spring.application.name=shop",
            "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}",
            "spring.kafka.consumer.auto-offset-reset=earliest"
        })
public class KafkaRecordListenerFixture {
    @TestConfiguration(proxyBeanMethods = false)
    @Import(Batches.class)
    static class Dispatch {
        /** The app's own interceptor, which Spring Boot puts on its listener container factory. */
        @Bean
        RecordInterceptor<Object, Object> audit(Audited audited) {
            return new RecordInterceptor<>() {
                @Override
                public ConsumerRecord<Object, Object> intercept(ConsumerRecord<Object, Object> record, Consumer<Object, Object> consumer) {
                    audited.count.incrementAndGet();
                    return record;
                }
            };
        }

        @Bean
        Audited audited() {
            return new Audited();
        }

        @Component
        static class OrderListener {
            private final ShopApp.OrderRepository orders;
            private final Batches batches;

            OrderListener(ShopApp.OrderRepository orders, Batches batches) {
                this.orders = orders;
                this.batches = batches;
            }

            @KafkaListener(id = "dispatch", topics = ShopApp.TOPIC, groupId = "dispatch", autoStartup = "false")
            void on(ConsumerRecord<String, String> record) {
                orders.save(new ShopApp.PlacedOrder("order-" + record.key(), record.key(), 1));
                batches.handled(1);
            }
        }
    }

    static class Audited {
        final AtomicInteger count = new AtomicInteger();
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

    @Autowired
    Audited audited;

    @Test
    void dispatchesThreeOrdersEachOnItsOwn() throws Exception {
        for (String sku : List.of("lamp-01", "desk-02", "chair-03")) {
            kafka.send(ShopApp.TOPIC, sku, "{\"sku\":\"" + sku + "\"}").get(30, TimeUnit.SECONDS);
        }
        listeners.getListenerContainer("dispatch").start();

        assertThat(batches.await(3, 30, TimeUnit.SECONDS)).isTrue();
        assertThat(audited.count.get()).isEqualTo(3);
    }
}
