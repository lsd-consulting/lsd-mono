package io.lsdconsulting.lsd.mono.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.lsdconsulting.lsd.mono.core.capture.CaptureDslKt;
import io.lsdconsulting.lsd.mono.core.capture.MessageBuilder;
import io.lsdconsulting.lsd.mono.core.domain.MessageType;
import io.lsdconsulting.lsd.mono.core.domain.NoteSide;
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType;
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError;
import io.lsdconsulting.lsd.mono.core.domain.Status;
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Locks in how the API reads from Java: the verbs' overloads, statics, scenarios, builders and
 * converters. A change that breaks a call here breaks Java users, so it must be deliberate.
 */
class JavaApiTest {
    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString());
        System.setProperty(LsdProperties.DETERMINISTIC_IDS, "true");
    }

    @AfterEach
    void tearDown() {
        System.clearProperty(LsdProperties.OUTPUT_DIR);
        System.clearProperty(LsdProperties.DETERMINISTIC_IDS);
    }

    record Order(String id) {}

    @Test
    void everyVerbCanBeCalledFromJava() throws Exception {
        LsdContext lsd = new LsdContext();
        lsd.addParticipants(ParticipantType.ACTOR.called("Customer"), ParticipantType.DATABASE.called("Db"));
        lsd.getPayloads().register(Order.class, order -> Map.of("order", order.id()));

        lsd.message("Customer", "Api");
        lsd.message("Customer", "Api", "POST /orders");
        lsd.message("Customer", "Api", "POST /orders", new Order("o-1"));
        lsd.message("Customer", "Api", "lost", null, MessageType.LOST);
        lsd.message("Api", "Db", "late", null, MessageType.SYNCHRONOUS, 5L, "#f00", Instant.parse("2026-01-01T00:00:00Z"));
        lsd.response("Db", "Api");
        lsd.response("Db", "Api", "1 row", Map.of("rows", 1));
        lsd.async("Api", "Queue", "order.placed");
        lsd.inbound("Api", "probe");
        lsd.outbound("Api");
        lsd.note("over", "Api");
        lsd.note("left", "Api", NoteSide.LEFT);
        lsd.note("right edge", null, NoteSide.RIGHT);
        lsd.activate("Api");
        lsd.activate("Db", "#0f0");
        lsd.deactivate("Db");
        lsd.deactivate("Api");
        lsd.section("Phase 2");
        lsd.divider("checkout");
        lsd.delay();
        lsd.delay("5 minutes");
        lsd.spacer();
        lsd.spacer(48);
        lsd.addFact("flag");
        lsd.addFact("orderId", "o-1");
        lsd.capture(new MessageBuilder().from("Api").to("Customer").label("201").type(MessageType.SYNCHRONOUS_RESPONSE));
        lsd.capture(CaptureDslKt.noteOver("Api", "builder note"), CaptureDslKt.section("Phase 3"));
        lsd.completeScenario("Java", "every verb", Status.SUCCESS);

        String json = events(Files.readString(reportJson(lsd.completeReport("Java"))));
        assertEquals(
            List.of(
                "message", "message", "message", "message", "message", "message", "message", "message", "message",
                "message", "note", "note", "note", "activate", "activate", "deactivate", "deactivate", "section",
                "divider", "delay", "delay", "spacer", "spacer", "message", "note", "section"),
            all(json, "\"kind\": \"(\\w+)\""));
        assertEquals("late", all(json, "\"label\": \"([^\"]*)\"").get(0), "the timed message sorts first");
        assertTrue(json.contains("\"order\": \"o-1\"") || Files.readString(payloads(tempDir)).contains("o-1"), json);
        assertTrue(json.contains("\"createdAt\": \"2026-01-01T00:00:00Z\""), json);
    }

    @Test
    void scenariosStaticsAndErrorsCanBeUsedFromJava() throws Exception {
        LsdContext lsd = new LsdContext();
        LsdScenario scenario = lsd.beginScenario("java-report");
        try (AutoCloseable bound = scenario.bind()) {
            lsd.message("A", "B", "bound");
        }
        scenario.message("B", "A", "direct");
        scenario.note("note", "A");
        scenario.addFact("k", "v");
        scenario.complete("Failed", "", Status.ERROR, ScenarioError.of("Failed", new IllegalStateException("boom")));
        assertEquals(LsdContext.class, LsdContext.getInstance().getClass());

        String json = Files.readString(reportJson(lsd.completeReport("Java", "java-report")));
        assertEquals(List.of("bound", "direct"), all(events(json), "\"label\": \"([^\"]*)\""));
        assertTrue(json.contains("\"headline\": \"Failed\""), json);
        assertTrue(json.contains("\"message\": \"boom\""), json);
    }

    private static Path reportJson(Path reportHtml) {
        return reportHtml.resolveSibling(reportHtml.getFileName().toString().replace("-report.html", "-report.json"));
    }

    private static Path payloads(Path dir) throws IOException {
        try (var files = Files.list(dir)) {
            return files.filter(p -> p.getFileName().toString().endsWith("-payloads.js")).findFirst().orElseThrow();
        }
    }

    /** The scenarios' event lists, without the insights that precede them. */
    private static String events(String json) {
        return json.substring(json.indexOf("\"events\""));
    }

    private static List<String> all(String text, String regex) {
        List<String> found = new ArrayList<>();
        Matcher matcher = Pattern.compile(regex).matcher(text);
        while (matcher.find()) found.add(matcher.group(1));
        return found;
    }
}
