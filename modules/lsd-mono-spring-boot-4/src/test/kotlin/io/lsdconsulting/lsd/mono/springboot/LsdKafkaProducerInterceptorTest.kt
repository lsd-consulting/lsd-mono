package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.clients.producer.RecordMetadata
import org.apache.kafka.common.TopicPartition
import org.apache.kafka.common.errors.RecordTooLargeException
import org.apache.kafka.common.errors.TimeoutException
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/** What the producer interceptor draws when Kafka acknowledges a send, or reports it failed. */
@LsdTestConfig(deterministicIds = true)
class LsdKafkaProducerInterceptorTest {
    @TempDir
    lateinit var tempDir: Path

    private val interceptor =
        LsdKafkaProducerInterceptor().apply {
            configure(mapOf(KafkaCapture.APP_CONFIG to "Shop", KafkaCapture.CLIENT_CONFIG to "Client"))
        }
    private val metadata = RecordMetadata(TopicPartition("orders.placed", 0), 7, 0, 0, 3, 40)
    private var scenario: LsdScenario? = null

    @BeforeEach
    @AfterEach
    fun clear() {
        scenario?.let(SpringScenarios::finished)
        scenario = null
        LsdContext.instance.clear()
    }

    private fun start(): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = "kafka", key = "kafka-test").also {
            SpringScenarios.started(it)
            scenario = it
        }

    private fun send(): ProducerRecord<Any?, Any?> = interceptor.onSend(ProducerRecord("orders.placed", "lamp-01", """{"sku":"lamp-01"}"""))

    private fun ack(
        record: ProducerRecord<Any?, Any?>,
        exception: Exception?,
    ) = interceptor.onAcknowledgement(if (exception == null) metadata else null, exception, record.headers())

    private fun report(scenario: LsdScenario): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete("sends an order")
        return ReportJson.read(LsdContext.instance.completeReport("kafka", "kafka").reportJson).scenario("sends an order")
    }

    private fun ScenarioJson.failures() = messages.filter { it["status"] == "error" }

    @Test
    fun `a failed send is an error reply from the topic to the sender, with the exception's message`() {
        val scenario = start()
        val record = send()

        ack(record, RecordTooLargeException("The message is 1024 bytes when serialized which is larger than 32.\n\tat somewhere"))

        val drawn = report(scenario)
        val failure = drawn.message("RecordTooLargeException")
        assertEquals("error", failure["status"], drawn.json)
        assertEquals(drawn.message("publish \"lamp-01\"")["to"], failure["from"], drawn.json)
        assertEquals("client", failure["to"].toString().lowercase(), drawn.json)
        assertTrue(failure.source.contains("The message is 1024 bytes when serialized which is larger than 32."), failure.source)
        assertFalse(failure.source.contains("somewhere"), "only the first line: ${failure.source}")
        assertTrue(failure.source.contains("org.apache.kafka.common.errors.RecordTooLargeException"), failure.source)
    }

    @Test
    fun `a successful send draws only its publish`() {
        val scenario = start()
        val record = send()

        ack(record, null)
        ack(record, TimeoutException("a second report of the same send"))

        val drawn = report(scenario)
        assertEquals(listOf("publish \"lamp-01\""), drawn.labels, drawn.json)
        assertTrue(drawn.failures().isEmpty(), drawn.json)
    }

    @Test
    fun `one send reported failed twice is drawn once`() {
        val scenario = start()
        val record = send()

        ack(record, TimeoutException("Expiring 1 record(s)"))
        ack(record, TimeoutException("Expiring 1 record(s)"))

        assertEquals(1, report(scenario).failures().size)
    }

    @Test
    fun `an acknowledgement after its scenario has finished is dropped`() {
        val scenario = start()
        val record = send()
        SpringScenarios.finished(scenario)

        ack(record, TimeoutException("Expiring 1 record(s)"))

        val drawn = report(scenario)
        assertTrue(drawn.failures().isEmpty(), drawn.json)
    }

    @Test
    fun `with no scenario running nothing is stamped or drawn, and acknowledgements are ignored`() {
        val record = send()

        assertNull(record.headers().lastHeader(KafkaCapture.PUBLISH_ID_HEADER))
        ack(record, TimeoutException("Expiring 1 record(s)"))
        interceptor.onAcknowledgement(null, TimeoutException("no headers"), null)
        interceptor.onAcknowledgement(metadata, null)

        val scenario = start()
        record.headers().add(KafkaCapture.PUBLISH_ID_HEADER, "unknown".toByteArray())
        ack(record, TimeoutException("someone else's send"))
        assertTrue(report(scenario).messages.isEmpty())
    }

    @Test
    fun `an exception that misbehaves is still drawn and never thrown`() {
        val scenario = start()
        val throwing = send()
        val anonymous = send()
        val long = send()

        ack(throwing, RudeException())
        ack(anonymous, object : Exception() {})
        ack(long, TimeoutException("x".repeat(5000)))

        val drawn = report(scenario)
        assertEquals(3, drawn.failures().size, drawn.json)
        assertFalse(drawn.message("RudeException").source.contains("no message for you"), drawn.json)
        assertTrue(
            drawn.labels.any { it.startsWith(LsdKafkaProducerInterceptorTest::class.java.name + "$") },
            "an anonymous class goes by its name: ${drawn.labels}",
        )
        val truncated = drawn.message("TimeoutException").source
        assertFalse(truncated.contains("x".repeat(200)), "the message is cut short: $truncated")
        assertTrue(truncated.contains("x".repeat(199) + "…"), truncated)
    }
}

private class RudeException : RecordTooLargeException("unused") {
    override val message: String get() = throw IllegalStateException("no message for you")
}
