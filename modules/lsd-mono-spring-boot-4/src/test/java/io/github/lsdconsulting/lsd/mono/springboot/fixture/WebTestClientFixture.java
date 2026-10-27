package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.springframework.web.reactive.function.server.RouterFunctions.route;

import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webtestclient.autoconfigure.AutoConfigureWebTestClient;
import org.springframework.context.annotation.Bean;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.http.codec.multipart.FilePart;
import org.springframework.http.codec.multipart.Part;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;

/**
 * A reactive shop tested the way {@code @WebFluxTest}-style tests usually are: through Spring
 * Boot's {@code WebTestClient}, bound to the application context, with no server running. It
 * places an order that it prices over a {@code WebClient}, takes an order's documents as a
 * multipart upload into a controller ({@code @RequestPart}) and a return's label into a router
 * function ({@code ServerRequest.multipartData()}), and answers 404 for an order it does not know,
 * through Spring Boot's error handling. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@AutoConfigureWebTestClient
@SpringBootTest(
        classes = WebTestClientFixture.App.class,
        properties = {"spring.application.name=shop", "spring.main.web-application-type=reactive"})
public class WebTestClientFixture {
    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        @RestController
        static class Orders {
            private final WebClient pricing;

            Orders(WebClient.Builder clients, @Value("${shop.pricing.url}") String pricingUrl) {
                this.pricing = clients.clone().baseUrl(pricingUrl).build();
            }

            @PostMapping("/orders/{sku}")
            Mono<ResponseEntity<Map<String, Object>>> place(@PathVariable("sku") String sku) {
                return pricing.post()
                        .uri("/quotes")
                        .bodyValue(Map.of("sku", sku, "quantity", 1))
                        .retrieve()
                        .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                        .map(quote -> ResponseEntity.status(201).body(Map.of("order", "order-7", "total", quote.get("total"))));
            }

            @PostMapping(path = "/orders/{id}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
            Mono<ResponseEntity<Map<String, Object>>> documents(
                    @PathVariable("id") String id,
                    @RequestPart("invoice") FilePart invoice,
                    @RequestPart("note") String note) {
                return size(invoice).map(bytes -> ResponseEntity.status(201)
                        .body(Map.of("order", id, "invoice", invoice.filename(), "bytes", bytes, "note", note)));
            }

            @GetMapping("/orders/{id}")
            Mono<Map<String, Object>> order(@PathVariable("id") String id) {
                return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND, "no such order"));
            }
        }

        @Bean
        RouterFunction<ServerResponse> returns() {
            return route().POST("/returns/{id}/label", request -> request.multipartData()
                            .flatMap(parts -> size(parts.getFirst("label")))
                            .flatMap(bytes -> ServerResponse.status(201)
                                    .bodyValue(Map.of("return", request.pathVariable("id"), "bytes", bytes))))
                    .build();
        }

        static Mono<Long> size(Part part) {
            return DataBufferUtils.join(part.content()).map(joined -> {
                long bytes = joined.readableByteCount();
                DataBufferUtils.release(joined);
                return bytes;
            });
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.pricing.url", () -> Stubs.url(Stubs.PRICING));
    }

    @Autowired
    WebTestClient client;

    private static ByteArrayResource file(String name, String contents) {
        return new ByteArrayResource(contents.getBytes()) {
            @Override
            public String getFilename() {
                return name;
            }
        };
    }

    @Test
    void placesAnOrder() {
        client.post()
                .uri("/orders/lamp-01")
                .exchange()
                .expectStatus()
                .isCreated()
                .expectBody()
                .jsonPath("$.total")
                .isEqualTo(49.0);
    }

    @Test
    void takesAnOrdersDocuments() {
        MultipartBodyBuilder parts = new MultipartBodyBuilder();
        parts.part("invoice", file("invoice-7.pdf", "%PDF-1.7 an invoice for order-7"))
                .contentType(MediaType.APPLICATION_PDF);
        parts.part("note", "leave it with the neighbour");
        client.post()
                .uri("/orders/order-7/documents")
                .body(BodyInserters.fromMultipartData(parts.build()))
                .exchange()
                .expectStatus()
                .isCreated()
                .expectBody()
                .jsonPath("$.bytes")
                .isEqualTo(31);
    }

    @Test
    void takesTheReturnsLabel() {
        MultipartBodyBuilder parts = new MultipartBodyBuilder();
        parts.part("label", file("return-7.png", "PNG a return label")).contentType(MediaType.IMAGE_PNG);
        client.post()
                .uri("/returns/return-7/label")
                .body(BodyInserters.fromMultipartData(parts.build()))
                .exchange()
                .expectStatus()
                .isCreated()
                .expectBody()
                .jsonPath("$.bytes")
                .isEqualTo(18);
    }

    @Test
    void looksUpAnOrderNobodyKnows() {
        client.get()
                .uri("/orders/order-404")
                .exchange()
                .expectStatus()
                .isNotFound()
                .expectBody()
                .jsonPath("$.status")
                .isEqualTo(404);
    }
}
