package io.github.lsdconsulting.lsd.mono.springboot;

import org.springframework.boot.resttestclient.autoconfigure.RestTestClientBuilderCustomizer;

/**
 * What the starter adds to Spring Boot's {@code RestTestClient}. Java, as the builder's
 * {@code requestInterceptor} is generic in its own type, which Kotlin cannot infer here.
 */
final class LsdRestTestClients {
    private LsdRestTestClients() {}

    static RestTestClientBuilderCustomizer customizer() {
        return builder -> builder.requestInterceptor(LsdRestTestClient.interceptor());
    }
}
