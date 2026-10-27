package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.apache.kafka.clients.consumer.Consumer
import org.apache.kafka.clients.consumer.ConsumerRecord
import org.apache.kafka.clients.consumer.ConsumerRecords
import org.springframework.kafka.config.AbstractKafkaListenerContainerFactory
import org.springframework.kafka.listener.BatchInterceptor
import org.springframework.kafka.listener.CompositeBatchInterceptor
import org.springframework.kafka.listener.CompositeRecordInterceptor
import org.springframework.kafka.listener.RecordInterceptor

/**
 * Tells the starter which polled record a record listener is about to handle, so the calls it
 * makes hang off that record's consume rather than the last one in the poll. It changes nothing
 * about the record, and does nothing for a record no scenario drew.
 */
internal class LsdRecordInterceptor : RecordInterceptor<Any, Any> {
    override fun intercept(
        record: ConsumerRecord<Any, Any>,
        consumer: Consumer<Any, Any>,
    ): ConsumerRecord<Any, Any> {
        guarded(Unit) { SpringScenarios.handle(record) }
        return record
    }
}

/**
 * The batch twin of [LsdRecordInterceptor]. One call to a batch listener serves every record in the
 * batch, so its calls cannot be split between them: they hang off the batch's last record, which
 * is the poll's last record unless the container splits a poll into batches.
 */
internal class LsdBatchInterceptor : BatchInterceptor<Any, Any> {
    override fun intercept(
        records: ConsumerRecords<Any, Any>,
        consumer: Consumer<Any, Any>,
    ): ConsumerRecords<Any, Any> {
        guarded(Unit) { records.reversed().firstOrNull { SpringScenarios.handle(it) } }
        return records
    }
}

/** Ours, then the app's own; marked so a factory is never given ours twice. */
private class LsdCompositeRecordInterceptor(
    vararg delegates: RecordInterceptor<Any, Any>,
) : CompositeRecordInterceptor<Any, Any>(*delegates)

private class LsdCompositeBatchInterceptor(
    vararg delegates: BatchInterceptor<Any, Any>,
) : CompositeBatchInterceptor<Any, Any>(*delegates)

internal object ListenerInterceptors {
    /**
     * Puts ours in front of the record and batch interceptors a listener container factory already
     * has (Spring Boot sets the app's `RecordInterceptor` or `BatchInterceptor` bean on its own
     * factory), so the app's keep running, and on the record they returned.
     */
    @Suppress("UNCHECKED_CAST")
    fun install(factory: AbstractKafkaListenerContainerFactory<*, *, *>) {
        val typed = factory as AbstractKafkaListenerContainerFactory<*, Any, Any>
        val record = typed.recordInterceptor
        if (record !is LsdRecordInterceptor && record !is LsdCompositeRecordInterceptor) {
            typed.setRecordInterceptor(
                if (record == null) LsdRecordInterceptor() else LsdCompositeRecordInterceptor(LsdRecordInterceptor(), record),
            )
        }
        val batch = typed.batchInterceptor
        if (batch !is LsdBatchInterceptor && batch !is LsdCompositeBatchInterceptor) {
            typed.setBatchInterceptor(
                if (batch == null) LsdBatchInterceptor() else LsdCompositeBatchInterceptor(LsdBatchInterceptor(), batch),
            )
        }
    }
}
