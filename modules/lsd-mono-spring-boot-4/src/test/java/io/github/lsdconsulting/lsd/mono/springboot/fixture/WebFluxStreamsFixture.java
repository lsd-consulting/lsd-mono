package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * A reactive shop that streams and uploads: it streams an order's progress as server-sent events,
 * follows a courier's own event stream through a {@code WebClient}, files an invoice with an
 * archive as a multipart upload, and fails in the ways handlers do: a
 * {@code ResponseStatusException} and an exception nothing handles, both answered by Spring Boot's
 * error handling. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = WebFluxStreamsFixture.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "spring.main.web-application-type=reactive"})
public class WebFluxStreamsFixture {
    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        @RestController
        static class Orders {
            private final WebClient courier;
            private final WebClient archive;

            Orders(
                    WebClient.Builder clients,
                    @Value("${shop.courier.url}") String courierUrl,
                    @Value("${shop.archive.url}") String archiveUrl) {
                this.courier = clients.clone().baseUrl(courierUrl).build();
                this.archive = clients.clone().baseUrl(archiveUrl).build();
            }

            @GetMapping(path = "/orders/{id}/progress", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
            Flux<ServerSentEvent<Map<String, Object>>> progress(@PathVariable("id") String id) {
                return Flux.range(1, 7)
                        .delayElements(Duration.ofMillis(5))
                        .map(step -> ServerSentEvent.<Map<String, Object>>builder(Map.of("order", id, "step", step))
                                .event("progress")
                                .id(String.valueOf(step))
                                .build());
            }

            @GetMapping("/orders/{id}/parcel")
            Mono<Map<String, Object>> parcel(@PathVariable("id") String id) {
                return courier.get()
                        .uri("/parcels/{id}/scans", id)
                        .accept(MediaType.TEXT_EVENT_STREAM)
                        .retrieve()
                        .bodyToFlux(new ParameterizedTypeReference<ServerSentEvent<String>>() {})
                        .count()
                        .map(scans -> Map.of("order", id, "scans", scans));
            }

            @PostMapping("/orders/{id}/invoice")
            Mono<ResponseEntity<Map<String, Object>>> invoice(@PathVariable("id") String id) {
                MultipartBodyBuilder parts = new MultipartBodyBuilder();
                parts.part("order", id);
                parts.part("invoice", new ByteArrayResource("%PDF-1.7 an invoice for order-7".getBytes()) {
                            @Override
                            public String getFilename() {
                                return "invoice-7.pdf";
                            }
                        })
                        .contentType(MediaType.APPLICATION_PDF);
                return archive.post()
                        .uri("/files")
                        .body(BodyInserters.fromMultipartData(parts.build()))
                        .retrieve()
                        .toBodilessEntity()
                        .map(ignored -> ResponseEntity.status(201).body(Map.of("order", id, "archived", true)));
            }

            @GetMapping("/orders/{id}")
            Mono<Map<String, Object>> order(@PathVariable("id") String id) {
                return Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND, "no such order"));
            }

            @PostMapping("/orders/{id}/cancel")
            Mono<Map<String, Object>> cancel(@PathVariable("id") String id) {
                return Mono.error(new IllegalStateException("order " + id + " has shipped"));
            }
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.courier.url", () -> Stubs.url(Stubs.COURIER));
        registry.add("shop.archive.url", () -> Stubs.url(Stubs.ARCHIVE));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    private HttpResponse<String> send(HttpRequest.Builder request) throws Exception {
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest.Builder to(String path) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + path));
    }

    @Test
    void streamsAnOrdersProgress() throws Exception {
        HttpResponse<String> response = send(to("/orders/order-7/progress").header("Accept", "text/event-stream"));
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).contains("id:7");
    }

    @Test
    void followsTheCouriersScans() throws Exception {
        HttpResponse<String> response = send(to("/orders/order-7/parcel"));
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(JsonParserFactory.getJsonParser().parseMap(response.body())).containsEntry("scans", 7);
    }

    @Test
    void filesAnInvoice() throws Exception {
        HttpResponse<String> response = send(to("/orders/order-7/invoice").POST(HttpRequest.BodyPublishers.noBody()));
        assertThat(response.statusCode()).isEqualTo(201);
    }

    @Test
    void looksUpAnOrderNobodyKnows() throws Exception {
        HttpResponse<String> response = send(to("/orders/order-404"));
        assertThat(response.statusCode()).isEqualTo(404);
        assertThat(JsonParserFactory.getJsonParser().parseMap(response.body())).containsEntry("status", 404);
    }

    @Test
    void cancelsAnOrderThatHasShipped() throws Exception {
        HttpResponse<String> response = send(to("/orders/order-7/cancel").POST(HttpRequest.BodyPublishers.noBody()));
        assertThat(response.statusCode()).isEqualTo(500);
        assertThat(JsonParserFactory.getJsonParser().parseMap(response.body())).containsEntry("status", 500);
    }
}
