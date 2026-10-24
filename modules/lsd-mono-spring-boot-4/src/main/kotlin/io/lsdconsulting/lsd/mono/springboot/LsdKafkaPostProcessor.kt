package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.context.EnvironmentAware
import org.springframework.core.env.Environment
import org.springframework.kafka.config.AbstractKafkaListenerContainerFactory
import org.springframework.kafka.core.ConsumerFactory
import org.springframework.kafka.core.KafkaTemplate
import org.springframework.kafka.core.ProducerFactory

/**
 * Adds the starter's Kafka interceptors to every producer and consumer factory the app's beans
 * use, whoever built them: Spring Boot's own factories, `ProducerFactory` and `ConsumerFactory`
 * beans the app declares itself (Boot then backs off), and factories built inline in a
 * `KafkaTemplate` or listener container factory bean. Only `interceptor.classes` and the participant
 * names are added; the interceptors themselves draw nothing unless a test scenario is running.
 *
 * A raw `KafkaProducer` or `KafkaConsumer` made with `new`, outside any Spring factory, is not seen.
 */
internal class LsdKafkaPostProcessor :
    BeanPostProcessor,
    EnvironmentAware {
    private lateinit var env: Environment
    private val names by lazy { ParticipantNames(env) }
    private val consumers by lazy { env.getProperty(CONSUMER_ENABLED, Boolean::class.java, true) }

    override fun setEnvironment(environment: Environment) {
        env = environment
    }

    override fun postProcessAfterInitialization(
        bean: Any,
        beanName: String,
    ): Any {
        when (bean) {
            is ProducerFactory<*, *> -> producers(bean)
            is KafkaTemplate<*, *> -> producers(bean.producerFactory)
            is ConsumerFactory<*, *> -> if (consumers) consumers(bean)
            is AbstractKafkaListenerContainerFactory<*, *, *> -> if (consumers) bean.consumerFactory?.let { consumers(it) }
        }
        return bean
    }

    private fun producers(factory: ProducerFactory<*, *>) =
        instrument(factory::getConfigurationProperties, factory::updateConfigs, LsdKafkaProducerInterceptor::class.java)

    private fun consumers(factory: ConsumerFactory<*, *>) =
        instrument(factory::getConfigurationProperties, factory::updateConfigs, LsdKafkaConsumerInterceptor::class.java)

    private fun instrument(
        current: () -> Map<String, Any?>,
        update: (Map<String, Any>) -> Unit,
        interceptor: Class<*>,
    ) {
        guarded(Unit) {
            // A ProducerFactory or ConsumerFactory of the app's own that keeps no config map: leave it.
            val configs =
                try {
                    current()
                } catch (_: UnsupportedOperationException) {
                    return@guarded
                }
            if (KafkaCapture.isInstrumented(configs, interceptor)) return@guarded
            update(KafkaCapture.configs(configs, interceptor, names))
        }
    }

    companion object {
        const val CONSUMER_ENABLED: String = "lsd.mono.spring.kafka.consumer.enabled"
    }
}
