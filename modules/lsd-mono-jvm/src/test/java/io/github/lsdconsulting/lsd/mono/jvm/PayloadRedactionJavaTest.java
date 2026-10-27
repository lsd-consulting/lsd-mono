package io.github.lsdconsulting.lsd.mono.jvm;

import static org.junit.jupiter.api.Assertions.assertSame;

import org.junit.jupiter.api.Test;

/** The redaction API reads naturally from Java (#43). */
class PayloadRedactionJavaTest {
    @Test
    void redactionRulesCanBeAddedFromJava() {
        PayloadConverters payloads = new LsdContext().getPayloads();
        assertSame(payloads, payloads.redact("ssn", "pin"));
        assertSame(payloads, payloads.redactWhen(key -> key.startsWith("x-internal-")));
        payloads.clearRedaction();
    }
}
