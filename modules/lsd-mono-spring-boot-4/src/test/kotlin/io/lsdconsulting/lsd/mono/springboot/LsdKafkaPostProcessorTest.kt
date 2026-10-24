package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test
import org.springframework.kafka.config.ConcurrentKafkaListenerContainerFactory
import org.springframework.kafka.core.ConsumerFactory
import org.springframework.kafka.core.DefaultKafkaConsumerFactory
import org.springframework.kafka.core.DefaultKafkaProducerFactory
import org.springframework.kafka.core.KafkaTemplate
import org.springframework.kafka.core.ProducerFactory
import org.springframework.mock.env.MockEnvironment

class LsdKafkaPostProcessorTest {
    private val producer = LsdKafkaProducerInterceptor::class.java.name
    private val consumer = LsdKafkaConsumerInterceptor::class.java.name

    private fun processor(vararg properties: Pair<String, String>) =
        LsdKafkaPostProcessor().apply {
            setEnvironment(
                MockEnvironment().apply {
                    withProperty("spring.application.name", "shop")
                    properties.forEach { (k, v) -> withProperty(k, v) }
                },
            )
        }

    private fun interceptors(configs: Map<String, Any?>) = configs[KafkaCapture.INTERCEPTORS]

    @Test
    fun `a producer factory bean gets the producer interceptor and the names, once`() {
        val factory = DefaultKafkaProducerFactory<String, String>(mapOf(KafkaCapture.INTERCEPTORS to "com.example.Audit"))
        val processor = processor()

        processor.postProcessAfterInitialization(factory, "producerFactory")
        processor.postProcessAfterInitialization(KafkaTemplate(factory), "kafkaTemplate")

        assertEquals(listOf("com.example.Audit", producer), interceptors(factory.configurationProperties))
        assertEquals("Shop", factory.configurationProperties[KafkaCapture.APP_CONFIG])
    }

    @Test
    fun `a template's inline producer factory and a listener factory's inline consumer factory are instrumented`() {
        val producers = DefaultKafkaProducerFactory<String, String>(emptyMap())
        val consumers = DefaultKafkaConsumerFactory<String, String>(emptyMap())
        val listeners = ConcurrentKafkaListenerContainerFactory<String, String>().apply { setConsumerFactory(consumers) }
        val processor = processor()

        processor.postProcessAfterInitialization(KafkaTemplate(producers), "kafkaTemplate")
        processor.postProcessAfterInitialization(listeners, "kafkaListenerContainerFactory")

        assertEquals(listOf(producer), interceptors(producers.configurationProperties))
        assertEquals(listOf(consumer), interceptors(consumers.configurationProperties))
    }

    @Test
    fun `a batch listener factory's consumer factory is instrumented like any other`() {
        val consumers = DefaultKafkaConsumerFactory<String, String>(emptyMap())
        val batch =
            ConcurrentKafkaListenerContainerFactory<String, String>().apply {
                setConsumerFactory(consumers)
                setBatchListener(true)
            }

        processor().postProcessAfterInitialization(batch, "batchFactory")

        assertEquals(listOf(consumer), interceptors(consumers.configurationProperties))
        assertEquals(true, batch.isBatchListener)
    }

    @Test
    fun `consumers are left alone when consumer capture is off`() {
        val consumers = DefaultKafkaConsumerFactory<String, String>(emptyMap())
        val processor = processor(LsdKafkaPostProcessor.CONSUMER_ENABLED to "false")

        processor.postProcessAfterInitialization(consumers, "consumerFactory")
        processor.postProcessAfterInitialization(
            ConcurrentKafkaListenerContainerFactory<String, String>().apply { setConsumerFactory(consumers) },
            "kafkaListenerContainerFactory",
        )

        assertNull(interceptors(consumers.configurationProperties))
    }

    @Test
    fun `a factory with no config map of its own, and any other bean, pass through untouched`() {
        val bare = object : ProducerFactory<String, String> {
            override fun createProducer() = throw UnsupportedOperationException()
        }
        val bareConsumers = object : ConsumerFactory<String, String> {
            override fun createConsumer(
                groupId: String?,
                clientIdPrefix: String?,
                clientIdSuffix: String?,
                properties: java.util.Properties?,
            ) = throw UnsupportedOperationException()

            override fun isAutoCommit() = false
        }
        val processor = processor()

        assertEquals(bare, processor.postProcessAfterInitialization(bare, "bare"))
        assertEquals(bareConsumers, processor.postProcessAfterInitialization(bareConsumers, "bareConsumers"))
        assertEquals("plain", processor.postProcessAfterInitialization("plain", "plain"))
    }

    @Test
    fun `an instrumented config needs both our interceptor and the names`() {
        val ours = LsdKafkaProducerInterceptor::class.java
        assertFalse(KafkaCapture.isInstrumented(mapOf(KafkaCapture.INTERCEPTORS to listOf(ours)), ours))
        assertFalse(KafkaCapture.isInstrumented(mapOf(KafkaCapture.APP_CONFIG to "Shop"), ours))
        assertEquals(
            true,
            KafkaCapture.isInstrumented(mapOf(KafkaCapture.INTERCEPTORS to ours.name, KafkaCapture.APP_CONFIG to "Shop"), ours),
        )
    }
}
