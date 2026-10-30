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

/** RestTestClient bound to a MockMvc without the app's filters. */
@Tag("lsd-fixture")
@AutoConfigureMockMvc(addFilters = false)
@AutoConfigureRestTestClient
@SpringBootTest(classes = RestTestClientApp.class, properties = {"spring.application.name=shop"})
public class RestTestClientNoFiltersFixture {
    @Autowired
    RestTestClient auto;

    @Autowired
    MockMvc mockMvc;

    @Test
    void autoMockMvc() {
        auto.get().uri("/orders/a3").exchange().expectStatus().isOk();
    }

    @Test
    void bindToMockMvc() {
        RestTestClient.bindTo(mockMvc)
                .requestInterceptor(LsdRestTestClient.interceptor())
                .build()
                .get()
                .uri("/orders/b3")
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
                .uri("/orders/d3")
                .exchange()
                .expectStatus()
                .isOk();
    }
}
