package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import io.github.lsdconsulting.lsd.mono.springboot.LsdRestTestClient;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.client.RestTestClient;
import org.springframework.web.context.WebApplicationContext;

/** RestTestClient in the JVM: MockMvc with Boot's filters (so the app's filter sees it too) and standalone. */
@Tag("lsd-fixture")
@AutoConfigureMockMvc
@AutoConfigureRestTestClient
@SpringBootTest(classes = RestTestClientApp.class, properties = {"spring.application.name=shop"})
public class RestTestClientMockMvcFixture {
    @Autowired
    RestTestClient auto;

    @Autowired
    MockMvc mockMvc;

    @Autowired
    WebApplicationContext context;

    @Test
    void autoMockMvc() {
        auto.get().uri("/orders/a2").exchange().expectStatus().isOk();
    }

    @Test
    void bindToMockMvc() {
        RestTestClient.bindTo(mockMvc)
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/orders/b2")
                .exchange()
                .expectStatus()
                .isOk();
    }

    @Test
    void bindToApplicationContext() {
        RestTestClient.bindToApplicationContext(context)
                .build()
                .mutate()
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/orders/c2")
                .exchange()
                .expectStatus()
                .isOk();
    }

    @Test
    void bindToController() {
        RestTestClient.bindToController(new RestTestClientApp.Orders())
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/orders/d2")
                .exchange()
                .expectStatus()
                .isOk();
    }

    @Test
    void bindToRouterFunction() {
        RestTestClient.bindToRouterFunction(RestTestClientApp.route())
                .build()
                .mutate()
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/routed/e2")
                .exchange()
                .expectStatus()
                .isOk();
    }

    @Test
    void doubled() {
        auto.mutate()
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/orders/f2")
                .exchange()
                .expectStatus()
                .isOk();
    }
}
