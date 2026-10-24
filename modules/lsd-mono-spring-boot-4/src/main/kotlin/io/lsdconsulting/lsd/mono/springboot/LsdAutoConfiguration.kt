package io.lsdconsulting.lsd.mono.springboot

import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.boot.restclient.RestClientCustomizer
import org.springframework.boot.restclient.RestTemplateCustomizer
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.env.Environment
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.server.WebFilter

/**
 * On with the dependency, off with `lsd.mono.spring.enabled=false`. Each part switches on only when
 * the app has what it instruments: a servlet web app (Spring MVC) or a reactive one (WebFlux),
 * Spring Boot's `RestClient.Builder` and `RestTemplateBuilder`, `WebClient`, Spring Kafka producer
 * and consumer factories, and Spring Data repositories. Every part is a no-op unless a test
 * scenario is running, so a stray production classpath draws nothing.
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

    /** Inbound WebFlux requests, annotated controllers and router functions, drawn from the caller to this app. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
    @ConditionalOnClass(name = ["org.springframework.web.server.WebFilter", "reactor.core.publisher.Mono"])
    public class Reactive {
        @Bean
        public fun lsdWebFilter(env: Environment): WebFilter = LsdWebFilter(ParticipantNames(env))
    }

    /**
     * Outbound calls through any `WebClient.Builder` or `WebClient` bean: Boot's builder and ones
     * the app builds itself. Servlet apps that use `WebClient` are covered too.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = ["org.springframework.web.reactive.function.client.WebClient", "reactor.core.publisher.Mono"])
    public class WebClients {
        public companion object {
            /** Static, as a post-processor must be, so it does not drag this configuration in early. */
            @Bean
            @JvmStatic
            public fun lsdWebClientPostProcessor(): BeanPostProcessor = LsdWebClientPostProcessor()
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
     * Records sent through any Spring producer factory the app's beans use (so any `KafkaTemplate`),
     * drawn as a publish to the topic, and records any of its listener containers poll (so any
     * `@KafkaListener`, record or batch), drawn as a consume per record. That covers Spring Boot's
     * own factories and ones the app builds itself. Off for consumers with
     * `lsd.mono.spring.kafka.consumer.enabled=false`.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(
        name = [
            "org.springframework.kafka.core.ProducerFactory",
            "org.apache.kafka.clients.producer.ProducerInterceptor",
        ],
    )
    public class Kafka {
        public companion object {
            /** Static, as a post-processor must be, so it does not drag this configuration in early. */
            @Bean
            @JvmStatic
            public fun lsdKafkaPostProcessor(): BeanPostProcessor = LsdKafkaPostProcessor()
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
