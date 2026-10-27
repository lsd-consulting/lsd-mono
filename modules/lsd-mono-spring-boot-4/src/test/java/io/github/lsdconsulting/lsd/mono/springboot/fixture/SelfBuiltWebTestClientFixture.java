package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import io.github.lsdconsulting.lsd.mono.springboot.LsdWebTestClient;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * A reactive shop whose tests build their own {@code WebTestClient}s, as many do: bound to the
 * running server, to the application context, and to a controller. Only the last needs {@code
 * LsdWebTestClient.configurer()}. Launched by StarterEndToEndTest.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = SelfBuiltWebTestClientFixture.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
            "spring.application.name=shop",
            "lsd.mono.spring.client-name=Tester",
            "spring.main.web-application-type=reactive"
        })
public class SelfBuiltWebTestClientFixture {
    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        @RestController
        static class Orders {
            @GetMapping("/orders/{id}")
            Mono<Map<String, String>> order(@PathVariable("id") String id) {
                return Mono.just(Map.of("order", id));
            }
        }
    }

    @LocalServerPort
    int port;

    @Autowired
    ApplicationContext context;

    private static void looksUp(WebTestClient client, String id) {
        client.get().uri("/orders/" + id).exchange().expectStatus().isOk().expectBody().jsonPath("$.order").isEqualTo(id);
    }

    @Test
    void looksUpAnOrderOverTheServer() {
        looksUp(WebTestClient.bindToServer().baseUrl("http://localhost:" + port).build(), "order-1");
    }

    @Test
    void looksUpAnOrderInTheContext() {
        looksUp(WebTestClient.bindToApplicationContext(context).build(), "order-2");
    }

    @Test
    void looksUpAnOrderAtTheController() {
        looksUp(
                WebTestClient.bindToController(new App.Orders())
                        .configureClient()
                        .apply(LsdWebTestClient.configurer())
                        .build(),
                "order-3");
    }
}
