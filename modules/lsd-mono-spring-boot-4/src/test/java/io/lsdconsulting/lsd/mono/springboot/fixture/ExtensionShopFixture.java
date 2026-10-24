package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/** A Spring Boot test that already uses LsdExtension: the starter leaves it to the extension. */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension.class)
@SpringBootTest(
        classes = ShopApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "shop.pricing.url=http://localhost:1", "shop.inventory.url=http://localhost:1"})
public class ExtensionShopFixture {
    @LocalServerPort
    int port;

    @Test
    void startsTheApp() {
        assertThat(port).isPositive();
    }
}
