package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * A Spring MVC shop that streams and uploads: it streams an order's progress as server-sent
 * events, takes an order's documents as a multipart upload and files the invoice with an archive
 * (a multipart call of its own), and fails in the ways handlers do: a {@code ResponseStatusException},
 * an exception nothing handles, and a {@code ProblemDetail} from its own exception handler. Nothing
 * here knows about LSD.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = MvcStreamsFixture.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.application.name=shop")
public class MvcStreamsFixture {
    static final ExecutorService STREAMS = Executors.newSingleThreadExecutor();

    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        static class InvoiceNotReady extends RuntimeException {}

        @RestController
        static class Orders {
            private final RestClient archive;

            Orders(RestClient.Builder clients, @Value("${shop.archive.url}") String archiveUrl) {
                this.archive = clients.baseUrl(archiveUrl).build();
            }

            @GetMapping(path = "/orders/{id}/progress", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
            SseEmitter progress(@PathVariable("id") String id) {
                SseEmitter emitter = new SseEmitter(10_000L);
                STREAMS.execute(() -> {
                    try {
                        for (int step = 1; step <= 7; step++) {
                            emitter.send(SseEmitter.event()
                                    .name("progress")
                                    .id(String.valueOf(step))
                                    .data(Map.of("order", id, "step", step), MediaType.APPLICATION_JSON));
                        }
                        emitter.complete();
                    } catch (Exception e) {
                        emitter.completeWithError(e);
                    }
                });
                return emitter;
            }

            @PostMapping("/orders/{id}/documents")
            ResponseEntity<Map<String, Object>> documents(
                    @PathVariable("id") String id,
                    @RequestPart("invoice") MultipartFile invoice,
                    @RequestParam("note") String note) throws Exception {
                MultiValueMap<String, Object> parts = new LinkedMultiValueMap<>();
                parts.add("order", id);
                parts.add("invoice", new ByteArrayResource(invoice.getBytes()) {
                    @Override
                    public String getFilename() {
                        return invoice.getOriginalFilename();
                    }
                });
                archive.post().uri("/files").contentType(MediaType.MULTIPART_FORM_DATA).body(parts).retrieve().toBodilessEntity();
                return ResponseEntity.status(201).body(Map.of("order", id, "stored", 2, "note", note));
            }

            @GetMapping("/orders/{id}")
            Map<String, Object> order(@PathVariable("id") String id) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no such order");
            }

            @PostMapping("/orders/{id}/cancel")
            Map<String, Object> cancel(@PathVariable("id") String id) {
                throw new IllegalStateException("order " + id + " has shipped");
            }

            @GetMapping("/orders/{id}/invoice")
            Map<String, Object> invoice(@PathVariable("id") String id) {
                throw new InvoiceNotReady();
            }

            @ExceptionHandler(InvoiceNotReady.class)
            ProblemDetail notReady() {
                ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, "the invoice is not ready yet");
                problem.setTitle("Invoice not ready");
                return problem;
            }
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.archive.url", () -> Stubs.url(Stubs.ARCHIVE));
    }

    @AfterAll
    static void stop() {
        STREAMS.shutdown();
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
    void uploadsAnOrdersDocuments() throws Exception {
        String boundary = "lsd-boundary";
        String body = "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"invoice\"; filename=\"invoice-7.pdf\"\r\n"
                + "Content-Type: application/pdf\r\n\r\n"
                + "%PDF-1.7 an invoice for order-7\r\n"
                + "--" + boundary + "\r\n"
                + "Content-Disposition: form-data; name=\"note\"\r\n\r\n"
                + "leave with the neighbour\r\n"
                + "--" + boundary + "--\r\n";
        HttpResponse<String> response = send(to("/orders/order-7/documents")
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8)));
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

    @Test
    void asksForAnInvoiceNotReadyYet() throws Exception {
        HttpResponse<String> response = send(to("/orders/order-7/invoice"));
        assertThat(response.statusCode()).isEqualTo(409);
        assertThat(response.body()).contains("not ready yet");
    }
}
