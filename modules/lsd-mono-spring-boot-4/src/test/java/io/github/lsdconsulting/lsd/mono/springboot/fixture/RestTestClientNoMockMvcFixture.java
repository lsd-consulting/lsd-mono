package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.client.RestTestClient;

/** Boot's RestTestClient with neither a server nor a MockMvc bean: bound to the application context. */
@Tag("lsd-fixture")
@AutoConfigureRestTestClient
@SpringBootTest(classes = RestTestClientApp.class, properties = {"spring.application.name=shop"})
public class RestTestClientNoMockMvcFixture {
    @Autowired
    RestTestClient auto;

    @Test
    void autoApplicationContext() {
        auto.get().uri("/orders/a4").exchange().expectStatus().isOk();
    }
}
