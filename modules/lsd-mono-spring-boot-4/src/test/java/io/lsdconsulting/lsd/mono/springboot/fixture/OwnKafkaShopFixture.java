package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.producer.ProducerConfig;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.apache.kafka.common.serialization.StringSerializer;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory;
import org.springframework.kafka.core.DefaultKafkaConsumerFactory;
import org.springframework.kafka.core.DefaultKafkaProducerFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.test.context.EmbeddedKafka;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The shop with its Kafka events on, but with the {@link KafkaTemplate} and the listener container
 * factory built by the app itself, each around a producer or consumer factory made inline, so
 * neither is Spring Boot's nor a bean. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = {ShopApp.class, OwnKafkaShopFixture.OwnKafka.class},
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "shop.events.enabled=true"})
public class OwnKafkaShopFixture {
    @TestConfiguration(proxyBeanMethods = false)
    static class OwnKafka {
        @Bean
        KafkaTemplate<String, String> kafkaTemplate(@Value("${spring.embedded.kafka.brokers}") String brokers) {
            return new KafkaTemplate<>(new DefaultKafkaProducerFactory<>(Map.of(
                    ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, brokers,
                    ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class,
                    ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class)));
        }

        @Bean
        ConcurrentKafkaListenerContainerFactory<String, String> kafkaListenerContainerFactory(
                @Value("${spring.embedded.kafka.brokers}") String brokers) {
            ConcurrentKafkaListenerContainerFactory<String, String> factory = new ConcurrentKafkaListenerContainerFactory<>();
            factory.setConsumerFactory(new DefaultKafkaConsumerFactory<>(Map.of(
                    ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, brokers,
                    ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                    ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                    ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class)));
            return factory;
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
        registry.add("shop.inventory.url", () -> Stubs.url(Stubs.INVENTORY));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    @Autowired
    ShopApp.Handled handled;

    @Test
    void announcesAnOrder() throws Exception {
        HttpRequest request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + "/orders/lamp-01"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"sku\":\"lamp-01\",\"quantity\":2}"))
                .build();
        assertThat(CLIENT.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(201);
        assertThat(handled.await(30, TimeUnit.SECONDS)).isTrue();
    }
}
