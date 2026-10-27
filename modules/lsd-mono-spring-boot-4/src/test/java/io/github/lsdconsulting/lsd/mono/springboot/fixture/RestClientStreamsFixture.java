package io.github.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.json.JsonParserFactory;
import org.springframework.boot.restclient.RestTemplateBuilder;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestTemplate;

/**
 * A Spring MVC shop that follows a courier's server-sent event stream through a blocking client:
 * a {@code RestClient} that reads the whole stream as text, and a {@code RestTemplate} that reads
 * it line by line as it arrives. Nothing here knows about LSD.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = RestClientStreamsFixture.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "spring.main.web-application-type=servlet"})
public class RestClientStreamsFixture {
    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        @RestController
        static class Parcels {
            private final RestClient courier;
            private final RestTemplate tracker;
            private final String courierUrl;

            Parcels(
                    RestClient.Builder clients,
                    RestTemplateBuilder templates,
                    @Value("${shop.courier.url}") String courierUrl) {
                this.courier = clients.baseUrl(courierUrl).build();
                this.tracker = templates.build();
                this.courierUrl = courierUrl;
            }

            @GetMapping("/orders/{id}/parcel")
            Map<String, Object> parcel(@PathVariable("id") String id) {
                String stream = courier.get()
                        .uri("/parcels/{id}/scans", id)
                        .accept(MediaType.TEXT_EVENT_STREAM)
                        .retrieve()
                        .body(String.class);
                return Map.of("order", id, "scans", stream.split("event: scan", -1).length - 1);
            }

            @GetMapping("/orders/{id}/parcel/depots")
            Map<String, Object> depots(@PathVariable("id") String id) {
                Integer depots = tracker.execute(
                        courierUrl + "/parcels/{id}/scans",
                        HttpMethod.GET,
                        request -> request.getHeaders().setAccept(java.util.List.of(MediaType.TEXT_EVENT_STREAM)),
                        response -> {
                            int seen = 0;
                            BufferedReader lines = new BufferedReader(
                                    new InputStreamReader(response.getBody(), StandardCharsets.UTF_8));
                            for (String line = lines.readLine(); line != null; line = lines.readLine()) {
                                if (line.startsWith("data:")) seen++;
                            }
                            return seen;
                        },
                        id);
                return Map.of("order", id, "depots", depots);
            }
        }
    }

    @DynamicPropertySource
    static void services(DynamicPropertyRegistry registry) {
        registry.add("shop.courier.url", () -> Stubs.url(Stubs.COURIER));
    }

    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @LocalServerPort
    int port;

    private Map<String, Object> get(String path) throws Exception {
        HttpResponse<String> response = CLIENT.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return JsonParserFactory.getJsonParser().parseMap(response.body());
    }

    @Test
    void followsTheCouriersScansThroughTheRestClient() throws Exception {
        assertThat(get("/orders/order-7/parcel")).containsEntry("scans", 7);
    }

    @Test
    void readsTheDepotsLineByLineThroughTheRestTemplate() throws Exception {
        assertThat(get("/orders/order-7/parcel/depots")).containsEntry("depots", 7);
    }
}
