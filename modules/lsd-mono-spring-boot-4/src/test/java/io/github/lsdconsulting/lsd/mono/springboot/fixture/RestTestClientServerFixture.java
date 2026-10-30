package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import io.github.lsdconsulting.lsd.mono.springboot.LsdRestTestClient;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.TestRestTemplate;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureTestRestTemplate;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.web.servlet.client.RestTestClient;

/** RestTestClient and TestRestTemplate against a real server: Boot's beans and ones the test builds. */
@Tag("lsd-fixture")
@AutoConfigureRestTestClient
@AutoConfigureTestRestTemplate
@SpringBootTest(
        classes = RestTestClientApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop"})
public class RestTestClientServerFixture {
    @Autowired
    RestTestClient auto;

    @Autowired
    TestRestTemplate template;

    @LocalServerPort
    int port;

    @Test
    void autoServer() {
        auto.get().uri("/orders/a1").exchange().expectStatus().isOk();
    }

    @Test
    void bindToServer() {
        RestTestClient.bindToServer()
                .baseUrl("http://localhost:" + port)
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/orders/m1")
                .exchange()
                .expectStatus()
                .isOk();
    }

    @Test
    void bootTestRestTemplate() {
        template.getForEntity("/orders/t1", String.class);
    }

    @Test
    void ownTestRestTemplate() {
        new TestRestTemplate(new RestTemplateBuilder().additionalInterceptors(LsdRestTestClient.interceptor()))
                .getForEntity("http://localhost:" + port + "/orders/p1", String.class);
    }
}
