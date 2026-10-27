package io.github.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment

class KafkaCaptureTest {
    private val names = ParticipantNames(MockEnvironment().withProperty("spring.application.name", "orders-service"))
    private val ours = LsdKafkaProducerInterceptor::class.java.name

    @Test
    fun `our interceptor is added after the app's own, once`() {
        assertEquals(listOf(ours), KafkaCapture.configs(emptyMap(), LsdKafkaProducerInterceptor::class.java, names)[KafkaCapture.INTERCEPTORS])
        assertEquals(
            listOf("com.example.Audit", ours),
            KafkaCapture.configs(
                mapOf(KafkaCapture.INTERCEPTORS to "com.example.Audit"),
                LsdKafkaProducerInterceptor::class.java,
                names,
            )[KafkaCapture.INTERCEPTORS],
        )
        assertEquals(
            listOf(String::class.java.name, ours),
            KafkaCapture.configs(
                mapOf(KafkaCapture.INTERCEPTORS to listOf(String::class.java, ours)),
                LsdKafkaProducerInterceptor::class.java,
                names,
            )[KafkaCapture.INTERCEPTORS],
        )
    }

    @Test
    fun `the interceptor learns the participant names from the client config`() {
        val configs = KafkaCapture.configs(emptyMap(), LsdKafkaProducerInterceptor::class.java, names)
        assertEquals("Orders service" to "Client", KafkaCapture.names(configs))
    }

    @Test
    fun `JSON payloads become trees, other text stays text`() {
        assertEquals(mapOf("sku" to "lamp-01"), KafkaCapture.payload("{\"sku\":\"lamp-01\"}"))
        assertEquals("plain", KafkaCapture.payload("plain"))
        assertEquals("publish \"lamp-01\"", KafkaCapture.label("lamp-01"))
        assertEquals("publish", KafkaCapture.label(null))
    }
}
