package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.Trace
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.apache.kafka.clients.consumer.ConsumerInterceptor
import org.apache.kafka.clients.consumer.ConsumerRecords
import org.apache.kafka.clients.consumer.OffsetAndMetadata
import org.apache.kafka.clients.producer.ProducerInterceptor
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.clients.producer.RecordMetadata
import org.apache.kafka.common.TopicPartition
import org.apache.kafka.common.header.Headers
import java.time.Instant
import java.util.IdentityHashMap

/**
 * Wires the interceptors into a Kafka client's configuration (see [LsdKafkaPostProcessor]):
 * appends ours to whatever `interceptor.classes` the app already has, and passes the participant
 * names along, since Kafka, not Spring, creates interceptors.
 */
internal object KafkaCapture {
    const val APP_CONFIG: String = "lsd.mono.spring.app-name"
    const val CLIENT_CONFIG: String = "lsd.mono.spring.client-name"
    const val INTERCEPTORS: String = "interceptor.classes"

    /** A consume's place in a poll of several records: `2 of 3`. */
    const val POLL_HEADER: String = "kafka.poll"

    /** `2 of 3` for the second of three records polled together; null for a poll of one. */
    fun place(
        index: Int,
        count: Int,
    ): String? = if (count > 1) "${index + 1} of $count" else null

    /** Who sent a message, so the consumer can pair its arrow with the publish. */
    const val PUBLISH_ID_HEADER: String = "lsd-publish-id"

    fun configs(
        current: Map<String, Any?>,
        interceptor: Class<*>,
        names: ParticipantNames,
    ): Map<String, Any> {
        val existing = interceptors(current)
        val all = if (interceptor.name in existing) existing else existing + interceptor.name
        return mapOf(INTERCEPTORS to all, APP_CONFIG to names.app, CLIENT_CONFIG to names.client)
    }

    /** Whether [configs] already has [interceptor] and the names: then there is nothing to add. */
    fun isInstrumented(
        configs: Map<String, Any?>,
        interceptor: Class<*>,
    ): Boolean = interceptor.name in interceptors(configs) && APP_CONFIG in configs

    private fun interceptors(configs: Map<String, Any?>): List<String> =
        when (val value = configs[INTERCEPTORS]) {
            null -> emptyList()
            is String -> value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            is Class<*> -> listOf(value.name)
            is Collection<*> -> value.mapNotNull { (it as? Class<*>)?.name ?: it?.toString()?.trim() }
            else -> listOf(value.toString())
        }

    /** A record's payload as the inspector shows it: JSON text as a tree, anything else as it is. */
    fun payload(value: Any?): Any? =
        when (value) {
            null -> null
            is ByteArray -> Bodies.read(value, "application/json")
            is String -> if (value.trimStart().startsWith("{") ||
                value.trimStart().startsWith("[")
            )
                Bodies.read(value.toByteArray(), "application/json") ?: value
            else
                value
            else -> value
        }

    fun label(key: Any?): String = if (key == null) "publish" else "publish ${Summaries.of(key)}"

    fun headers(
        key: Any?,
        headers: Headers?,
        place: String? = null,
    ): Map<String, String> {
        val out = linkedMapOf<String, String>()
        key?.let { out["kafka.key"] = Summaries.of(it) }
        place?.let { out[POLL_HEADER] = it }
        headers?.forEach { header ->
            if (!SpringScenarios.isOwnHeader(header.key())) {
                out[header.key()] = header.value()?.toString(Charsets.UTF_8) ?: ""
            }
        }
        return out
    }

    /** The publish a record carries in [PUBLISH_ID_HEADER], if our producer interceptor stamped it. */
    fun publishId(headers: Headers?): String? =
        headers
            ?.lastHeader(PUBLISH_ID_HEADER)
            ?.value()
            ?.toString(Charsets.UTF_8)

    /** An exception's first line, short enough for the inspector; null when it has none or reading it fails. */
    fun shortMessage(e: Throwable): String? =
        runCatching { e.message }
            .getOrNull()
            ?.lineSequence()
            ?.firstOrNull()
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { if (it.length > MESSAGE_LIMIT) it.take(MESSAGE_LIMIT - 1) + "…" else it }

    private const val MESSAGE_LIMIT = 200

    fun names(configs: Map<String, *>): Pair<String, String> =
        (configs[APP_CONFIG] as? String ?: "App") to (configs[CLIENT_CONFIG] as? String ?: ParticipantNames.DEFAULT_CLIENT)
}

/**
 * Draws each record a `KafkaTemplate` (or any producer from a Spring producer factory the app's
 * beans use) sends during a test, as a publish from the app to the topic: `Shop → orders.placed`,
 * with the key, headers and payload. It runs on the sending thread, before serialization.
 *
 * A send the producer reports as failed (too large, timed out, rejected by the broker) gets an
 * error reply from the topic to the sender, labelled with the exception and carrying its message.
 * Kafka reports it on its I/O thread, or on the sending thread when the producer rejects the
 * record itself; the record's `lsd-publish-id` header says which publish it was. A successful
 * acknowledgement draws nothing.
 */
internal class LsdKafkaProducerInterceptor : ProducerInterceptor<Any?, Any?> {
    private var app = "App"
    private var client = ParticipantNames.DEFAULT_CLIENT

    override fun configure(configs: Map<String, *>) {
        KafkaCapture.names(configs).let { (a, c) ->
            app = a
            client = c
        }
    }

    override fun onSend(record: ProducerRecord<Any?, Any?>): ProducerRecord<Any?, Any?> {
        val scenario = guarded(null) { SpringScenarios.resolve() } ?: return record
        guarded(Unit) {
            val id = SpringScenarios.newId()
            val parent = SpringScenarios.parentOf(scenario)
            val topic = record.topic()
            val publisher = if (parent == null) client else app
            SpringScenarios.declare(scenario, ParticipantType.QUEUE.called(topic))
            scenario.ingest(
                Interaction
                    .builder(InteractionKind.PUBLISH, publisher, topic, KafkaCapture.label(record.key()))
                    .interactionId(id)
                    .trace(Trace(scenario.correlationId, id, parent))
                    .source(SpringScenarios.SOURCE)
                    .startedAt(Instant.now())
                    .data(KafkaCapture.payload(record.value()))
                    .headers(KafkaCapture.headers(record.key(), record.headers()))
                    .build(),
            )
            SpringScenarios.published(id, scenario)
            // Read-only once a record has been sent before; then the consumer just goes unpaired and
            // its acknowledgement is not drawn.
            guarded(Unit) {
                record.headers().add(KafkaCapture.PUBLISH_ID_HEADER, id.toByteArray())
                SpringScenarios.sending(id, SpringScenarios.Sending(scenario, publisher, topic, System.nanoTime()))
            }
        }
        return record
    }

    /** Kafka 4.1+ passes the record's headers, which say which publish this is; older clients never call this. */
    override fun onAcknowledgement(
        metadata: RecordMetadata?,
        exception: Exception?,
        headers: Headers?,
    ) {
        guarded(Unit) {
            val publishId = KafkaCapture.publishId(headers) ?: return@guarded
            // Removed either way, so a success just stops waiting, and a second report of one send is ignored.
            val sent = SpringScenarios.acknowledged(publishId) ?: return@guarded
            if (exception != null) failed(sent, publishId, exception)
        }
    }

    override fun onAcknowledgement(
        metadata: RecordMetadata?,
        exception: Exception?,
    ) = Unit

    private fun failed(
        sent: SpringScenarios.Sending,
        publishId: String,
        exception: Exception,
    ) {
        val name = exception.javaClass.simpleName.ifEmpty { exception.javaClass.name }
        sent.scenario.ingest(
            Interaction
                .builder(InteractionKind.RESPONSE, sent.topic, sent.publisher, name)
                .status("error")
                .replyTo(publishId)
                .source(SpringScenarios.SOURCE)
                .durationMs((System.nanoTime() - sent.sentAt) / 1_000_000.0)
                .data(
                    buildMap {
                        put("exception", exception.javaClass.name)
                        KafkaCapture.shortMessage(exception)?.let { put("message", it) }
                    },
                ).build(),
        )
    }

    override fun close() = Unit
}

/**
 * Draws each record a Spring listener container (so any `@KafkaListener`) polls during a
 * test, as a consume from the topic to the app, paired with its publish when this JVM sent it.
 * Kafka runs the listener on the polling thread, so calls the listener makes are drawn from the app.
 *
 * It sits on the consumer, not the listener, so a batch listener (`List<ConsumerRecord>` or a `List`
 * of payloads) looks the same as a record one: each record in the poll is its own consume, paired
 * through its own `lsd-publish-id`. A poll of several records marks each consume with its place in
 * it (`kafka.poll: 2 of 3`). The listener's calls hang off the last record polled, unless the
 * container's interceptors ([LsdRecordInterceptor], [LsdBatchInterceptor]) say which record it is on.
 */
internal class LsdKafkaConsumerInterceptor : ConsumerInterceptor<Any?, Any?> {
    private var app = "App"

    override fun configure(configs: Map<String, *>) {
        app = KafkaCapture.names(configs).first
    }

    override fun onConsume(records: ConsumerRecords<Any?, Any?>): ConsumerRecords<Any?, Any?> {
        guarded(Unit) {
            var last: Pair<LsdScenario, String>? = null
            val drawn = IdentityHashMap<Any, Pair<LsdScenario, String>>()
            val count = records.count()
            for ((index, record) in records.withIndex()) {
                val publishId = KafkaCapture.publishId(record.headers())
                val scenario = SpringScenarios.publishedBy(publishId) ?: SpringScenarios.resolve() ?: continue
                val id = SpringScenarios.newId()
                SpringScenarios.declare(scenario, ParticipantType.QUEUE.called(record.topic()))
                scenario.ingest(
                    Interaction
                        .builder(
                            InteractionKind.CONSUME,
                            record.topic(),
                            app,
                            if (record.key() ==
                                null
                            )
                                "consume"
                            else
                                "consume ${Summaries.of(record.key())}",
                        ).interactionId(id)
                        .replyTo(publishId)
                        .trace(Trace(scenario.correlationId, id, publishId))
                        .source(SpringScenarios.SOURCE)
                        .startedAt(Instant.now())
                        .data(KafkaCapture.payload(record.value()))
                        .headers(KafkaCapture.headers(record.key(), record.headers(), KafkaCapture.place(index, count)))
                        .build(),
                )
                last = scenario to id
                drawn[record] = last
            }
            SpringScenarios.consuming(last?.first, last?.second)
            SpringScenarios.polled(drawn)
        }
        return records
    }

    override fun onCommit(offsets: Map<TopicPartition, OffsetAndMetadata>) = Unit

    override fun close() = Unit
}
