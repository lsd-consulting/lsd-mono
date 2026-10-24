package io.lsdconsulting.lsd.mono.springboot

import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.boot.kafka.autoconfigure.DefaultKafkaConsumerFactoryCustomizer
import org.springframework.boot.kafka.autoconfigure.DefaultKafkaProducerFactoryCustomizer
import org.springframework.boot.restclient.RestClientCustomizer
import org.springframework.boot.restclient.RestTemplateCustomizer
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.env.Environment
import org.springframework.web.filter.OncePerRequestFilter

/**
 * On with the dependency, off with `lsd.mono.spring.enabled=false`. Each part switches on only when
 * the app has what it instruments: a servlet web app (Spring MVC), Spring Boot's `RestClient.Builder`
 * and `RestTemplateBuilder`, Spring Boot's Kafka producer and consumer factories, and Spring Data
 * repositories. Every part is a no-op unless a test scenario is running, so a stray
 * production classpath draws nothing.
 *
 * The beans are Spring's own types; what sits behind them is internal to this module.
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "lsd.mono.spring", name = ["enabled"], havingValue = "true", matchIfMissing = true)
public class LsdAutoConfiguration {
    /** Inbound Spring MVC requests, drawn from the caller to this app. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    @ConditionalOnClass(name = ["org.springframework.web.filter.OncePerRequestFilter", "jakarta.servlet.Filter"])
    public class Servlet {
        @Bean
        public fun lsdInboundFilter(env: Environment): FilterRegistrationBean<OncePerRequestFilter> =
            FilterRegistrationBean<OncePerRequestFilter>(LsdInboundFilter(ParticipantNames(env))).apply {
                order = Ordered.HIGHEST_PRECEDENCE + 10
                setName("lsdInboundFilter")
            }
    }

    /** Outbound calls through any `RestClient` or `RestTemplate` built from Boot's builders. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = ["org.springframework.boot.restclient.RestClientCustomizer"])
    public class RestClients {
        @Bean
        public fun lsdRestClientCustomizer(env: Environment): RestClientCustomizer {
            val interceptor = LsdClientInterceptor(ParticipantNames(env))
            return RestClientCustomizer { it.requestInterceptor(interceptor) }
        }

        @Bean
        public fun lsdRestTemplateCustomizer(env: Environment): RestTemplateCustomizer {
            val interceptor = LsdClientInterceptor(ParticipantNames(env))
            return RestTemplateCustomizer { it.interceptors.add(interceptor) }
        }
    }

    /**
     * Records sent through Boot's producer factory (so any `KafkaTemplate` it backs), drawn as a
     * publish to the topic, and records Boot's consumer factory polls (so any `@KafkaListener`),
     * drawn as a consume. Off for consumers with `lsd.mono.spring.kafka.consumer.enabled=false`.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(
        name = [
            "org.springframework.boot.kafka.autoconfigure.DefaultKafkaProducerFactoryCustomizer",
            "org.apache.kafka.clients.producer.ProducerInterceptor",
        ],
    )
    public class Kafka {
        @Bean
        public fun lsdKafkaProducerFactoryCustomizer(env: Environment): DefaultKafkaProducerFactoryCustomizer =
            DefaultKafkaProducerFactoryCustomizer { factory ->
                factory.updateConfigs(
                    KafkaCapture.configs(factory.configurationProperties, LsdKafkaProducerInterceptor::class.java, ParticipantNames(env)),
                )
            }

        @Bean
        @ConditionalOnProperty(prefix = "lsd.mono.spring.kafka.consumer", name = ["enabled"], havingValue = "true", matchIfMissing = true)
        public fun lsdKafkaConsumerFactoryCustomizer(env: Environment): DefaultKafkaConsumerFactoryCustomizer =
            DefaultKafkaConsumerFactoryCustomizer { factory ->
                factory.updateConfigs(
                    KafkaCapture.configs(factory.configurationProperties, LsdKafkaConsumerInterceptor::class.java, ParticipantNames(env)),
                )
            }
    }

    /**
     * Calls to Spring Data repositories, any store: the method, a summary of its arguments and of
     * what came back. Nothing below the repository (JDBC, SQL) is drawn.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(
        name = [
            "org.springframework.data.repository.core.support.RepositoryFactoryBeanSupport",
            "org.aopalliance.intercept.MethodInterceptor",
        ],
    )
    @ConditionalOnProperty(prefix = "lsd.mono.spring.repositories", name = ["enabled"], havingValue = "true", matchIfMissing = true)
    public class Repositories {
        public companion object {
            /** Static, as a post-processor must be, so it does not drag this configuration in early. */
            @Bean
            @JvmStatic
            public fun lsdRepositoryPostProcessor(): BeanPostProcessor = LsdRepositoryPostProcessor()
        }
    }
}
