package io.github.lsdconsulting.lsd.mono.jvm;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType;
import io.github.lsdconsulting.lsd.mono.jvm.testing.IsolatedContextKt;
import io.github.lsdconsulting.lsd.mono.jvm.domain.Participant;
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType;
import io.github.lsdconsulting.lsd.mono.jvm.domain.ScenarioError;
import io.github.lsdconsulting.lsd.mono.report.model.AccuracyJson;
import io.github.lsdconsulting.lsd.mono.report.model.KnownMessageType;
import io.github.lsdconsulting.lsd.mono.report.model.KnownParticipantType;
import io.github.lsdconsulting.lsd.mono.report.model.KnownTimingSource;
import io.github.lsdconsulting.lsd.mono.report.model.PairAccuracyJson;
import io.github.lsdconsulting.lsd.mono.report.model.WarningJson;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Locks in how the v1 value types read from Java: builders, withers, factories and equality. */
class ValueTypesJavaTest {
    private static final Instant T0 = Instant.parse("2026-01-01T00:00:00Z");

    @Test
    void interactionBuilderToBuilderAndWithers() {
        Interaction call =
                Interaction.builder(InteractionKind.REQUEST, "web", "api", "POST /orders")
                        .interactionId("c1")
                        .startedAt(T0)
                        .durationMs(12.5)
                        .headers(Map.of("x", "1"))
                        .data("body")
                        .build();
        assertEquals("web", call.getFrom());
        assertEquals(12.5, call.getDurationMs());
        assertNull(call.getReplyTo());

        Interaction same = call.toBuilder().build();
        assertEquals(call, same);
        assertEquals(call.hashCode(), same.hashCode());

        Interaction relabelled = call.withLabel("PUT /orders");
        assertEquals("PUT /orders", relabelled.getLabel());
        assertNotEquals(call, relabelled);
        assertEquals(call, relabelled.withLabel("POST /orders"));
        assertTrue(call.toString().contains("POST /orders"));

        Interaction labelDefaulted = Interaction.builder(InteractionKind.RESPONSE, "api", "web").build();
        assertEquals("", labelDefaulted.getLabel());
    }

    @Test
    void timingFactoriesAndWithers() {
        Timing timing = Timing.at(T0).withDuration(Duration.ofMillis(5)).withSource("orders");
        assertEquals(T0, timing.getStartedAt());
        assertEquals(5.0, timing.getDurationMs());
        assertEquals(timing, Timing.of(T0, Duration.ofMillis(5)).withSource("orders"));
        assertNull(timing.withDurationMs(null).getDurationMs());
        assertNull(timing.withStartedAt(null).getStartedAt());
    }

    @Test
    void participantsAndErrorsAreValues() {
        Participant orders = ParticipantType.DATABASE.called("Orders");
        assertEquals(orders, ParticipantType.DATABASE.called("Orders"));
        assertEquals("orders", orders.getId());
        assertNotEquals(orders, ParticipantType.QUEUE.called("Orders"));

        ScenarioError given = ScenarioError.of("Failed", "boom", null);
        assertEquals(given, ScenarioError.of("Failed", "boom", null));
        assertNull(given.getStack());
        ScenarioError fromThrowable = ScenarioError.of("Failed", (Throwable) null);
        assertEquals("", fromThrowable.getMessage());
        ScenarioError ambiguousNull = ScenarioError.of("Failed", null);
        assertEquals(fromThrowable, ambiguousNull);
    }

    @Test
    void reportModelBuilders() {
        WarningJson warning = WarningJson.builder("SKEW", "clocks differ").build();
        assertEquals(warning, warning.toBuilder().build());
        assertEquals("SKEW", warning.getKind());

        PairAccuracyJson pair = PairAccuracyJson.builder("a", "b", AccuracyJson.MEASURED).build();
        assertEquals(pair, pair.toBuilder().build());
        assertEquals(AccuracyJson.MEASURED, pair.getAccuracy());
    }

    @Test
    void knownValueListsAreFields() {
        List<String> types = KnownParticipantType.ALL;
        assertTrue(types.contains(KnownParticipantType.DATABASE));
        assertTrue(KnownMessageType.ALL.contains(KnownMessageType.SYNCHRONOUS));
        assertTrue(KnownTimingSource.ALL.contains(KnownTimingSource.MEASURED));
    }

    @Test
    void messageOverloadsAreUnambiguous() {
        LsdContext lsd = IsolatedContextKt.isolatedLsdContext();
        assertDoesNotThrow(() -> {
            lsd.message("A", "B");
            lsd.message("A", "B", "label");
            lsd.message("A", "B", "label", MessageType.LOST);
            lsd.message("A", "B", "label", null);
            lsd.message("A", "B", "label", MessageType.SYNCHRONOUS, "body");
            lsd.message("A", "B", "label", null, "body", null, Timing.at(T0));
        });
    }
}
