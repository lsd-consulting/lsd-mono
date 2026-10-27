package io.github.lsdconsulting.lsd.mono.report.model;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
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
                .data(DataValueJson.ofObject(Map.of("amount", DataValueJson.of(new BigDecimal("12.50")))))
                .build();
        ReportJson report = ReportJson.builder("Checkout", "2026-01-01T12:00:00Z", "java-adapter 1.0", StatusJson.SUCCESS)
                .options(ReportOptionsJson.builder().usagePing(false).build())
                .scenario(ScenarioJson.builder("s1", "Pay", StatusJson.SUCCESS)
                        .participant(ParticipantJson.builder("shop", "Shop").type(KnownParticipantType.ACTOR).build())
                        .participant(ParticipantJson.builder("payments", "Payments")
                                .attribute("peer.service", "payments")
                                .attribute("lsd.instances", 2)
                                .build())
                        .event(call)
                        .build())
                .build();

        MessageEventJson written = (MessageEventJson) report.getScenarios().get(0).getEvents().get(0);
        assertEquals(List.of("http.route", "http.response.status_code"), List.copyOf(written.getAttributes().keySet()));
        assertEquals(201L, written.getAttributes().get("http.response.status_code").getValue());
        assertEquals(new TraceJson("4bf92f3577b34da6a3ce929d0e0e4736", "00f067aa0ba902b7", null), written.getTrace());
        assertEquals("imported", written.getOrigin());
        DataValueJson amount = ((DataValueJson.ObjectValue) written.getData()).get("amount");
        assertEquals(new BigDecimal("12.50"), ((DataValueJson.NumberValue) amount).toBigDecimal());
        assertEquals(DataValueJson.of("x"), DataValueJson.from("x"));
        assertEquals(DataValueJson.NullValue.INSTANCE, DataValueJson.NULL);
        ParticipantJson payments = report.getScenarios().get(0).getParticipants().get(1);
        assertEquals(List.of("peer.service", "lsd.instances"), List.copyOf(payments.getAttributes().keySet()));
        assertEquals(2L, payments.getAttributes().get("lsd.instances").getValue());
    }

    @Test
    void dataValuesAreMadeWithTheStaticFactories() {
        DataValueJson value = DataValueJson.ofList(List.of(
                DataValueJson.of("s"),
                DataValueJson.of(true),
                DataValueJson.of(1L),
                DataValueJson.of(2),
                DataValueJson.of(2.5),
                DataValueJson.of(new BigInteger("12345678901234567890")),
                DataValueJson.NULL));
        assertEquals(value, DataValueJson.from(List.of("s", true, 1L, 2, 2.5, new BigInteger("12345678901234567890"), DataValueJson.NULL)));
        assertEquals(
                "12345678901234567890",
                ((DataValueJson.NumberValue) ((DataValueJson.ArrayValue) value).getItems().get(5)).getLiteral());
    }
}
