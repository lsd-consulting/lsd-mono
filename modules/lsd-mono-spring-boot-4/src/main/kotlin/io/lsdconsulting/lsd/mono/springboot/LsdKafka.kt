package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.apache.kafka.clients.consumer.ConsumerInterceptor
import org.apache.kafka.clients.consumer.ConsumerRecords
import org.apache.kafka.clients.consumer.OffsetAndMetadata
import org.apache.kafka.clients.producer.ProducerInterceptor
import org.apache.kafka.clients.producer.ProducerRecord
import org.apache.kafka.clients.producer.RecordMetadata
import org.apache.kafka.common.TopicPartition
import org.apache.kafka.common.header.Headers
import java.time.Instant

/**
 * Wires the interceptors into a Kafka client's configuration: appends ours to whatever
 * `interceptor.classes` the app already has, and passes the participant names along, since Kafka,
 * not Spring, creates interceptors.
 */
internal object KafkaCapture {
    const val APP_CONFIG: String = "lsd.mono.spring.app-name"
    const val CLIENT_CONFIG: String = "lsd.mono.spring.client-name"
    const val INTERCEPTORS: String = "interceptor.classes"

    /** Who sent a message, so the consumer can pair its arrow with the publish. */
    const val PUBLISH_ID_HEADER: String = "lsd-publish-id"

    fun configs(
        current: Map<String, Any?>,
        interceptor: Class<*>,
        names: ParticipantNames,
    ): Map<String, Any> {
        val existing =
            when (val value = current[INTERCEPTORS]) {
                null -> emptyList()
                is String -> value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
                is Class<*> -> listOf(value.name)
                is Collection<*> -> value.mapNotNull { (it as? Class<*>)?.name ?: it?.toString()?.trim() }
                else -> listOf(value.toString())
            }
        val all = if (interceptor.name in existing) existing else existing + interceptor.name
        return mapOf(INTERCEPTORS to all, APP_CONFIG to names.app, CLIENT_CONFIG to names.client)
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
    ): Map<String, String> {
        val out = linkedMapOf<String, String>()
        key?.let { out["kafka.key"] = Summaries.of(it) }
        headers?.forEach { header ->
            if (!SpringScenarios.isOwnHeader(header.key())) {
                out[header.key()] = header.value()?.toString(Charsets.UTF_8) ?: ""
            }
        }
        return out
    }

    fun names(configs: Map<String, *>): Pair<String, String> =
        (configs[APP_CONFIG] as? String ?: "App") to (configs[CLIENT_CONFIG] as? String ?: ParticipantNames.DEFAULT_CLIENT)
}

/**
 * Draws each record a Spring Boot `KafkaTemplate` (or any producer from Boot's producer factory)
 * sends during a test, as a publish from the app to the topic: `Shop → orders.placed`, with the
 * key, headers and payload. It runs on the sending thread, before serialization.
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
            SpringScenarios.declare(scenario, ParticipantType.QUEUE.called(topic))
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.PUBLISH,
                    from = if (parent == null) client else app,
                    to = topic,
                    label = KafkaCapture.label(record.key()),
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, parent),
                    source = SpringScenarios.SOURCE,
                    startedAt = Instant.now(),
                    data = KafkaCapture.payload(record.value()),
                    headers = KafkaCapture.headers(record.key(), record.headers()),
                ),
            )
            SpringScenarios.published(id, scenario)
            // Read-only once a record has been sent before; then the consumer just goes unpaired.
            guarded(Unit) { record.headers().add(KafkaCapture.PUBLISH_ID_HEADER, id.toByteArray()) }
        }
        return record
    }

    override fun onAcknowledgement(
        metadata: RecordMetadata?,
        exception: Exception?,
    ) = Unit

    override fun close() = Unit
}

/**
 * Draws each record a Spring Boot listener container (so any `@KafkaListener`) polls during a
 * test, as a consume from the topic to the app, paired with its publish when this JVM sent it.
 * Kafka runs the listener on the polling thread, so calls the listener makes are drawn from the app.
 */
internal class LsdKafkaConsumerInterceptor : ConsumerInterceptor<Any?, Any?> {
    private var app = "App"

    override fun configure(configs: Map<String, *>) {
        app = KafkaCapture.names(configs).first
    }

    override fun onConsume(records: ConsumerRecords<Any?, Any?>): ConsumerRecords<Any?, Any?> {
        guarded(Unit) {
            var last: Pair<LsdScenario, String>? = null
            for (record in records) {
                val publishId = record
                    .headers()
                    .lastHeader(KafkaCapture.PUBLISH_ID_HEADER)
                    ?.value()
                    ?.toString(Charsets.UTF_8)
                val scenario = SpringScenarios.publishedBy(publishId) ?: SpringScenarios.resolve() ?: continue
                val id = SpringScenarios.newId()
                SpringScenarios.declare(scenario, ParticipantType.QUEUE.called(record.topic()))
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.CONSUME,
                        from = record.topic(),
                        to = app,
                        label = if (record.key() == null) "consume" else "consume ${Summaries.of(record.key())}",
                        interactionId = id,
                        replyTo = publishId,
                        trace = Trace(scenario.correlationId, id, publishId),
                        source = SpringScenarios.SOURCE,
                        startedAt = Instant.now(),
                        data = KafkaCapture.payload(record.value()),
                        headers = KafkaCapture.headers(record.key(), record.headers()),
                    ),
                )
                last = scenario to id
            }
            SpringScenarios.consuming(last?.first, last?.second)
        }
        return records
    }

    override fun onCommit(offsets: Map<TopicPartition, OffsetAndMetadata>) = Unit

    override fun close() = Unit
}
