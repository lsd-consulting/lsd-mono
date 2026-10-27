package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.config.KafkaListenerEndpointRegistry;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.stereotype.Component;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * A batch {@code @KafkaListener} taking a {@code List<String>} of payloads, on a batch container
 * factory the app builds itself around a consumer factory made inline, so neither is Spring Boot's
 * nor a bean. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = {ShopApp.class, OwnKafkaBatchListenerFixture.OwnBatch.class},
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "spring.kafka.bootstrap-servers=${spring.embedded.kafka.brokers}"})
public class OwnKafkaBatchListenerFixture {
    @TestConfiguration(proxyBeanMethods = false)
    @Import(Batches.class)
    static class OwnBatch {
        @Bean
        ConcurrentKafkaListenerContainerFactory<String, String> batchFactory(
                @Value("${spring.embedded.kafka.brokers}") String brokers) {
            ConcurrentKafkaListenerContainerFactory<String, String> factory = new ConcurrentKafkaListenerContainerFactory<>();
            factory.setConsumerFactory(new DefaultKafkaConsumerFactory<>(Map.of(
                    ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, brokers,
                    ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                    ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                    ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class)));
            factory.setBatchListener(true);
            return factory;
        }

        @Component
        static class OrderBatchListener {
            private final ShopApp.OrderRepository orders;
            private final Batches batches;

            OrderBatchListener(ShopApp.OrderRepository orders, Batches batches) {
                this.orders = orders;
                this.batches = batches;
            }

            @KafkaListener(
                    id = "dispatch",
                    topics = ShopApp.TOPIC,
                    groupId = "dispatch",
                    containerFactory = "batchFactory",
                    autoStartup = "false")
            void on(List<String> events) {
                orders.count();
                batches.handled(events.size());
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
