package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import org.apache.kafka.clients.consumer.Consumer
import org.apache.kafka.clients.consumer.ConsumerRecord
import org.apache.kafka.clients.consumer.ConsumerRecords
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.common.TopicPartition
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.lang.reflect.Proxy
import java.nio.file.Path

/**
 * What the consumer interceptor draws for one poll of several records, which is what a batch
 * listener is handed as one `List`: each record its own consume, paired with its own publish.
 */
@LsdTestConfig(deterministicIds = true)
class LsdKafkaConsumerInterceptorTest {
    @TempDir
    lateinit var tempDir: Path

    private val producer =
        LsdKafkaProducerInterceptor().apply {
            configure(mapOf(KafkaCapture.APP_CONFIG to "Shop", KafkaCapture.CLIENT_CONFIG to "Client"))
        }
    private val consumer = LsdKafkaConsumerInterceptor().apply { configure(mapOf(KafkaCapture.APP_CONFIG to "Shop")) }
    private val started = mutableListOf<LsdScenario>()

    @BeforeEach
    @AfterEach
    fun clear() {
        started.forEach(SpringScenarios::finished)
        started.clear()
        SpringScenarios.consuming(null, null)
        LsdContext.instance.clear()
    }

    private fun start(key: String = "batch-test"): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = key, key = key).also {
            SpringScenarios.started(it)
            started += it
        }

    /** A record as the broker hands it back, with the headers its publish stamped. */
    private fun sent(
        sku: String,
        offset: Long,
        scenario: LsdScenario? = null,
    ): ConsumerRecord<Any?, Any?> {
        val record = ProducerRecord<Any?, Any?>(TOPIC, sku, """{"sku":"$sku"}""")
        if (scenario != null) scenario.bind().use { producer.onSend(record) } else producer.onSend(record)
        return ConsumerRecord<Any?, Any?>(TOPIC, 0, offset, sku, record.value()).apply {
            record.headers().forEach { headers().add(it) }
        }
    }

    private fun poll(vararg records: ConsumerRecord<Any?, Any?>) =
        ConsumerRecords(mapOf(TopicPartition(TOPIC, 0) to records.toList()), emptyMap())

    /** Each scenario is its own report, keyed and titled by the key it was started with. */
    private fun report(
        scenario: LsdScenario,
        key: String = "batch-test",
    ): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(key)
        return ReportJson.read(LsdContext.instance.completeReport(key, key).reportJson).scenario(key)
    }

    @Test
    fun `every record in one poll is its own consume, paired with its own publish, in order`() {
        val scenario = start()
        val batch = poll(sent("lamp-01", 0), sent("desk-02", 1), sent("chair-03", 2))

        assertSame(batch, consumer.onConsume(batch))

        val drawn = report(scenario)
        val skus = listOf("lamp-01", "desk-02", "chair-03")
        assertEquals(skus.map { "publish \"$it\"" } + skus.map { "consume \"$it\"" }, drawn.labels, drawn.json)
        for (sku in skus) {
            val consume = drawn.message("consume \"$sku\"")
            assertEquals(drawn.message("publish \"$sku\"")["callId"], consume["causedBy"], drawn.json)
            assertEquals("orders-placed", consume["from"], drawn.json)
            assertEquals("shop", consume["to"], drawn.json)
            assertEquals(sku, consume.obj("data")?.obj("body")?.string("sku"), consume.source)
        }
    }

    @Test
    fun `calls the listener makes for the batch hang off its last record`() {
        val scenario = start()

        consumer.onConsume(poll(sent("lamp-01", 0), sent("desk-02", 1)))
        val repositoryCallParent = SpringScenarios.parentOf(scenario)

        val drawn = report(scenario)
        assertEquals(drawn.message("consume \"desk-02\"").obj("trace")?.string("spanId"), repositoryCallParent, drawn.json)
    }

    @Test
    fun `records of two running scenarios in one batch each join their own publisher's diagram`() {
        val first = start("first")
        val second = start("second")
        val batch = poll(sent("lamp-01", 0, first), sent("desk-02", 1, second))

        consumer.onConsume(batch)

        val one = report(first, "first")
        val two = report(second, "second")
        assertEquals(listOf("publish \"lamp-01\"", "consume \"lamp-01\""), one.labels, one.json)
        assertEquals(listOf("publish \"desk-02\"", "consume \"desk-02\""), two.labels, two.json)
    }

    @Test
    fun `with no scenario running a batch passes through untouched and marks nothing as handled`() {
        val batch = poll(sent("lamp-01", 0), sent("desk-02", 1))

        assertSame(batch, consumer.onConsume(batch))
        assertNull(batch.first().headers().lastHeader(KafkaCapture.PUBLISH_ID_HEADER))

        val scenario = start()
        assertNull(SpringScenarios.parentOf(scenario))
        assertTrue(report(scenario).messages.isEmpty())
    }

    @Test
    fun `records from outside the test, with no publish id, join the one running scenario unpaired`() {
        val scenario = start()
        val foreign = ConsumerRecord<Any?, Any?>(TOPIC, 0, 0, null, "plain text")

        consumer.onConsume(poll(foreign, ConsumerRecord(TOPIC, 0, 1, "desk-02", null)))

        val drawn = report(scenario)
        assertEquals(listOf("consume", "consume \"desk-02\""), drawn.labels, drawn.json)
        assertNull(drawn.message("consume")["causedBy"], drawn.json)
    }

    @Test
    fun `a batch that is only part of the poll hangs its calls off its own last record, not the poll's`() {
        val scenario = start()
        val lamp = sent("lamp-01", 0)
        val desk = sent("desk-02", 1)
        consumer.onConsume(poll(lamp, desk))

        // The container split the poll: this batch is lamp alone (as with subBatchPerPartition).
        val batch = poll(lamp)
        assertSame(batch, LsdBatchInterceptor().intercept(batch.typed(), noConsumer()))
        val repositoryCallParent = SpringScenarios.parentOf(scenario)

        val drawn = report(scenario)
        assertEquals(drawn.message("consume \"lamp-01\"").obj("trace")?.string("spanId"), repositoryCallParent, drawn.json)
    }

    @Test
    fun `a batch of records no scenario drew leaves what the poll set alone`() {
        val scenario = start()
        consumer.onConsume(poll(sent("lamp-01", 0), sent("desk-02", 1)))

        LsdBatchInterceptor().intercept(poll(ConsumerRecord(TOPIC, 0, 9, "other", "not polled")).typed(), noConsumer())

        val repositoryCallParent = SpringScenarios.parentOf(scenario)
        val drawn = report(scenario)
        assertEquals(drawn.message("consume \"desk-02\"").obj("trace")?.string("spanId"), repositoryCallParent, drawn.json)
    }

    @Suppress("UNCHECKED_CAST")
    private fun ConsumerRecords<Any?, Any?>.typed() = this as ConsumerRecords<Any, Any>

    /** The interceptor never touches the consumer. */
    @Suppress("UNCHECKED_CAST")
    private fun noConsumer(): Consumer<Any, Any> =
        Proxy.newProxyInstance(javaClass.classLoader, arrayOf(Consumer::class.java)) { _, method, _ ->
            error("unexpected call to ${method.name}")
        } as Consumer<Any, Any>

    private companion object {
        const val TOPIC = "orders.placed"
    }
}
