package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import java.util.Map;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.function.RouterFunction;
import org.springframework.web.servlet.function.RouterFunctions;
import org.springframework.web.servlet.function.ServerResponse;

/** A servlet shop with one controller, and a router function for {@code bindToRouterFunction}. */
@SpringBootConfiguration(proxyBeanMethods = false)
@EnableAutoConfiguration
public class RestTestClientApp {
    @RestController
    public static class Orders {
        @GetMapping("/orders/{id}")
        public Map<String, String> order(@PathVariable("id") String id) {
            return Map.of("order", id);
        }
    }

    public static RouterFunction<ServerResponse> route() {
        return RouterFunctions.route()
                .GET("/routed/{id}", r -> ServerResponse.ok().body(Map.of("routed", r.pathVariable("id"))))
                .build();
    }
}
