package io.github.lsdconsulting.lsd.mono.jvm;


import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType;
import io.github.lsdconsulting.lsd.mono.jvm.domain.NoteSide;
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType;
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError;
import io.github.lsdconsulting.lsd.mono.jvm.domain.Status;
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig;
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson;
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson;
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Locks in how the API reads from Java: the verbs' overloads, capture blocks, statics, scenarios
 * and converters. A change that breaks a call here breaks Java users, so it must be deliberate.
 */
@LsdTestConfig(deterministicIds = true)
class JavaApiTest {
    @TempDir
    Path tempDir;

    record Order(String id) {}

    @Test
    void everyVerbCanBeCalledFromJava() throws Exception {
        LsdContext lsd = new LsdContext();
        lsd.addParticipants(ParticipantType.ACTOR.called("Customer"), ParticipantType.DATABASE.called("Db"));
        lsd.getPayloads().register(Order.class, order -> Map.of("order", order.id()));

        lsd.message("Customer", "Api");
        lsd.message("Customer", "Api", "POST /orders");
        lsd.message("Customer", "Api", "POST /orders", MessageType.SYNCHRONOUS, new Order("o-1"));
        lsd.message("Customer", "Api", "lost", MessageType.LOST, null);
        lsd.message("Customer", "Api", "lost again", MessageType.LOST);
        lsd.message("Api", "Db", "late", MessageType.SYNCHRONOUS, null, "#f00", Timing.of(Instant.parse("2026-01-01T00:00:00Z"), java.time.Duration.ofMillis(5)));
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
        lsd.capture(c -> {
            c.calls("Api", "Db").label("select").data(Map.of("sql", "select 1")).took(3L).colour("#00f");
            c.repliesTo("Db", "Api").label("1 row");
            c.sends("Api", "Queue").label("order.read");
            c.note("in a block", "Api");
        });
        PendingCall call = lsd.call("Customer", "Api", "GET /orders");
        call.reply("200 OK", Map.of("orders", 0));
        lsd.call("Api", "Db", "select", Map.of("sql", "select 1")).fail(new IllegalStateException("timeout"));
        lsd.call("Api", "Db").reply();
        lsd.completeScenario("Java", "every verb", Status.SUCCESS);

        ScenarioJson json = report(lsd.completeReport("Java")).scenario("Java");
        assertEquals(
            List.of(
                "message", "message", "message", "message", "message", "message", "message", "message", "message",
                "message", "message", "note", "note", "note", "activate", "activate", "deactivate", "deactivate", "section",
                "divider", "delay", "delay", "spacer", "spacer", "message", "message", "message", "note", "message",
                "message", "message", "message", "message", "message"),
            values(json.getEvents(), "kind"));
        assertTrue(values(json.getMessages(), "timing").contains("measured"), json.toString());
        // The order is inline, or in the payloads file when the data is held there.
        boolean inline = json.getMessages().stream()
                .anyMatch(m -> m.get("data") instanceof Map<?, ?> data && "o-1".equals(data.get("order")));
        assertTrue(inline || Files.readString(payloads(tempDir)).contains("o-1"), json.toString());
        assertTrue(values(json.getMessages(), "startedAt").contains("2026-01-01T00:00:00Z"), json.toString());
        assertTrue(json.getLabels().contains("IllegalStateException"), json.toString());
        assertEquals(
                2,
                values(json.getMessages(), "type").stream().filter("lost"::equals).count(),
                "a MessageType in the data position is the type");
    }

    @Test
    void timingIsConfiguredFromJavaWithALambda() throws Exception {
        LsdContext lsd = new LsdContext();
        assertSame(lsd, lsd.configure(t -> t.orderByStartedAt(ClockOrdering.OFF)));
        assertEquals(ClockOrdering.OFF, lsd.getTimingConfig().orderByStartedAt());
        lsd.message("A", "B", "ping");
        lsd.completeScenario("java-timing");
        ScenarioJson json = report(lsd.completeReport("Java timing")).scenario("java-timing");
        assertEquals("off", json.get("clockOrdering"), json.toString());

        lsd.configure(t -> t.orderByStartedAt(null));
        assertEquals(null, lsd.getTimingConfig().orderByStartedAt());
        assertEquals(ClockOrdering.SAME_SOURCE, lsd.getTimingConfig().effectiveOrderByStartedAt());
    }

    @Test
    void scenariosStaticsAndErrorsCanBeUsedFromJava() throws Exception {
        LsdContext lsd = new LsdContext();
        LsdScenario scenario = lsd.beginScenario("java-report");
        try (AutoCloseable bound = scenario.bind()) {
            lsd.message("A", "B", "bound");
        }
        scenario.message("B", "A", "direct");
        scenario.capture(c -> c.calls("A", "B").label("block"));
        LsdScenario shared = LsdContext.getInstance().beginScenario("java-shared", "java-api-test-shared");
        Lsd.lsd(c -> c.note("shorthand", "A"));
        shared.discard();
        scenario.note("note", "A");
        scenario.addFact("k", "v");
        scenario.complete("Failed", "", Status.ERROR, ScenarioError.of("Failed", new IllegalStateException("boom")));
        assertEquals(LsdContext.class, LsdContext.getInstance().getClass());
        assertEquals("lsd-scenario", LsdHeaders.SCENARIO);

        ScenarioJson json = report(lsd.completeReport("Java", "java-report")).scenario("Failed");
        assertEquals(List.of("bound", "direct", "block"), json.getLabels());
        assertEquals("Failed", json.getError().get("headline"), json.toString());
        assertEquals("boom", json.getError().get("message"), json.toString());
    }

    @Test
    void scopedScenariosAndReportsCanBeUsedFromJava() throws Exception {
        LsdContext lsd = new LsdContext();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            ReportFiles report = lsd.report("Java blocks", r -> {
                r.scenario("Expression lambda", s -> s.addFact("k", "v"));
                r.scenario("Block lambda", "with a description", s -> {
                    s.message("A", "B", "receiver");
                    lsd.message("A", "B", "context");
                });
                int n = r.scenario("Returns a value", () -> {
                    lsd.message("A", "B", "callable");
                    return 7;
                });
                assertEquals(7, n);
                lsd.scenario("Through the context", s -> s.message("A", "B", "nested in report"));
            });
            String fromPool = lsd.scenario("Wrapped", () -> pool.submit(lsd.wrap(() -> {
                lsd.message("Worker", "Db", "wrapped");
                return "row";
            })).get());
            assertEquals("row", fromPool);
            assertThrows(IllegalStateException.class, () -> lsd.scenario("Throws", s -> {
                throw new IllegalStateException("boom");
            }));

            assertEquals(List.of("receiver", "context", "callable", "nested in report"), labels(report(report)));
            ReportJson other = report(lsd.completeReport("Java default"));
            assertEquals(List.of("wrapped"), labels(other));
            assertTrue(
                    other.getScenarios().stream().anyMatch(s -> s.getError() != null && "boom".equals(s.getError().get("message"))),
                    other.getText());
        } finally {
            pool.shutdownNow();
        }
    }

    /** Only IOException, from reading the report: binding a scenario must not force a catch. */
    @Test
    void nullsAndBindingsNeedNoWorkaroundsFromJava() throws IOException {
        LsdContext lsd = new LsdContext();
        LsdScenario scenario = lsd.beginScenario("java-traps", "java-traps", false);
        try (LsdBinding bound = scenario.bind()) {
            lsd.message("A", "B", "null type", null);
            lsd.message("A", "B", "null type with data", null, Map.of("k", 1));
            assertSame(scenario, lsd.currentScenario());
        }
        assertEquals(null, lsd.currentScenario(), "closing the binding restores the previous one");
        scenario.note("over", "A");
        scenario.note("edge", null, NoteSide.RIGHT);
        assertThrows(IllegalArgumentException.class, () -> scenario.note("over nothing", null));
        scenario.complete("Traps");

        ScenarioJson json = report(lsd.completeReport("Java traps", "java-traps")).scenario("Traps");
        assertEquals(List.of("null type", "null type with data"), json.getLabels());
        assertEquals(List.of("synchronous", "synchronous"), values(json.getMessages(), "type"));
    }

    @Test
    void interactionsWithStatusAndHeadersCanBeBuiltFromJava() throws IOException {
        LsdContext lsd = new LsdContext();
        lsd.accept(Interaction.builder(InteractionKind.REQUEST, "Web", "Api", "POST /orders").interactionId("c1").build());
        lsd.accept(Interaction.builder(InteractionKind.RESPONSE, "Api", "Web", "Created").status("201").replyTo("c1").build());
        lsd.accept(Interaction.builder(InteractionKind.PUBLISH, "Api", "Kafka", "order.placed")
            .data(Map.of("id", 7))
            .headers(Map.of("content-type", "application/json", "Authorization", "Bearer secret"))
            .build());
        lsd.completeScenario("java-interactions");

        Path file = reportJson(lsd.completeReport("Java interactions"));
        ScenarioJson json = ReportJson.Companion.read(file).scenario("java-interactions");

        assertEquals("201", json.message("Created").get("status"), json.toString());
        JsonObject published = json.message("order.placed").obj("data");
        assertEquals("application/json", published.obj("headers").get("content-type"), json.toString());
        assertEquals(Map.of("id", 7.0), Map.copyOf(published.obj("body")), json.toString());
        // Raw text on purpose: the secret must appear nowhere in the file, under any key.
        assertTrue(!Files.readString(file).contains("Bearer secret"), "authorization is redacted");
    }

    @Test
    void completeReportCompletesAForgottenScenarioAsWarn() throws IOException {
        LsdContext lsd = new LsdContext();
        LsdScenario forgotten = lsd.beginScenario("java-forgotten", "java-forgotten", false);
        forgotten.message("Shop", "Orders", "kept");

        ScenarioJson json = report(lsd.completeReport("Java forgotten", "java-forgotten")).scenario("java-forgotten");

        assertTrue(!forgotten.isActive(), "the report completed it");
        assertEquals("warn", json.getStatus(), json.toString());
        assertTrue(json.getDescription().contains("Scenario was not completed before the report was written"), json.toString());
        assertEquals(List.of("kept"), json.getLabels());
    }

    private static Path reportJson(ReportFiles files) {
        return files.getReportJson();
    }

    private static Path payloads(Path dir) throws IOException {
        try (var files = Files.list(dir)) {
            return files.filter(p -> p.getFileName().toString().endsWith("-payloads.js")).findFirst().orElseThrow();
        }
    }

    private static ReportJson report(ReportFiles files) {
        return ReportJson.Companion.read(reportJson(files));
    }

    /** Every scenario's message labels, in report order. */
    private static List<String> labels(ReportJson report) {
        return report.getScenarios().stream().flatMap(s -> s.getLabels().stream()).toList();
    }

    /** The [key] of each of [objects], in order (null where it is absent). */
    private static List<Object> values(List<JsonObject> objects, String key) {
        List<Object> found = new ArrayList<>();
        for (JsonObject o : objects) found.add(o.get(key));
        return found;
    }
}
