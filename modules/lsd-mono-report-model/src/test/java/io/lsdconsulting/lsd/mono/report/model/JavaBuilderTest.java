package io.lsdconsulting.lsd.mono.report.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * A Java producer builds a report with the builders (#118): only the required values are
 * arguments, and every optional one is a named setter, so a field added later breaks no caller.
 */
class JavaBuilderTest {
    @Test
    void aJavaProducerSetsOnlyWhatItHas() {
        MessageEventJson call = MessageEventJson.builder("m1", "shop", "payments", "POST /payments", KnownMessageType.SYNCHRONOUS)
                .durationMs(12.5)
                .trace(new TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7"))
                .attribute("http.route", "/payments")
                .attribute("http.response.status_code", 201)
                .origin(KnownMessageOrigin.IMPORTED)
                .build();
        ReportJson report = ReportJson.builder("Checkout", "2026-01-01T12:00:00Z", "java-adapter 1.0", StatusJson.SUCCESS)
                .options(ReportOptionsJson.builder().usagePing(false).build())
                .scenario(ScenarioJson.builder("s1", "Pay", StatusJson.SUCCESS)
                        .participant(ParticipantJson.builder("shop", "Shop").type(KnownParticipantType.ACTOR).build())
                        .participant(ParticipantJson.builder("payments", "Payments").build())
                        .event(call)
                        .build())
                .build();

        MessageEventJson written = (MessageEventJson) report.getScenarios().get(0).getEvents().get(0);
        assertEquals(List.of("http.route", "http.response.status_code"), List.copyOf(written.getAttributes().keySet()));
        assertEquals(201L, written.getAttributes().get("http.response.status_code").getValue());
        assertEquals(new TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", null), written.getTrace());
        assertEquals("imported", written.getOrigin());
    }
}
