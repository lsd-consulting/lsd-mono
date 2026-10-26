package io.lsdconsulting.lsd.mono.springboot

import jakarta.servlet.ServletRequestListener
import org.springframework.beans.factory.ObjectProvider
import org.springframework.beans.factory.config.BeanFactoryPostProcessor
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication
import org.springframework.boot.restclient.RestClientCustomizer
import org.springframework.boot.restclient.RestTemplateCustomizer
import org.springframework.boot.web.servlet.FilterRegistrationBean
import org.springframework.boot.web.servlet.ServletListenerRegistrationBean
import org.springframework.boot.webtestclient.autoconfigure.WebTestClientBuilderCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.env.Environment
import org.springframework.http.server.reactive.HttpHandlerDecoratorFactory
import org.springframework.messaging.simp.annotation.support.SimpAnnotationMethodMessageHandler
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.server.WebFilter
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer

/**
 * On with the dependency, off with `lsd.mono.spring.enabled=false`. Each part switches on only when
 * the app has what it instruments: a servlet web app (Spring MVC) or a reactive one (WebFlux),
 * Spring Boot's `RestClient.Builder` and `RestTemplateBuilder`, `WebClient`, Spring Kafka producer
 * and consumer factories, and Spring Data repositories. Every part is a no-op unless a test
 * scenario is running, so a stray production classpath draws nothing.
 *
 * The beans are Spring's own types; what sits behind them is internal to this module. Each
 * post-processor bean is static (`@JvmStatic` in a companion), as a post-processor must be, so it
 * does not drag its configuration in early.
 */
@AutoConfiguration
@ConditionalOnProperty(prefix = "lsd.mono.spring", name = ["enabled"], havingValue = "true", matchIfMissing = true)
public class LsdAutoConfiguration {
    /** Inbound Spring MVC requests, drawn from the caller to this app. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    @ConditionalOnClass(name = ["org.springframework.web.filter.OncePerRequestFilter", "jakarta.servlet.Filter"])
    internal class Servlet {
        @Bean
        public fun lsdInboundFilter(env: Environment): FilterRegistrationBean<OncePerRequestFilter> =
            FilterRegistrationBean<OncePerRequestFilter>(LsdInboundFilter(ParticipantNames(env), readParts(env))).apply {
                order = Ordered.HIGHEST_PRECEDENCE + 10
                setName("lsdInboundFilter")
            }

        /** Draws the reply of a failed request whose error page never came, as the request ends. */
        @Bean
        public fun lsdPendingReplies(): ServletListenerRegistrationBean<ServletRequestListener> =
            ServletListenerRegistrationBean<ServletRequestListener>(LsdInboundFilter.PendingReplies())

        /**
         * Multipart requests are drawn as their parts, read up front through the servlet's own
         * parsing: on unless `lsd.mono.spring.multipart.parts.enabled=false`, or the app turned
         * Spring Boot's multipart handling off or made it lazy.
         */
        private fun readParts(env: Environment): Boolean =
            env.getProperty("lsd.mono.spring.multipart.parts.enabled", Boolean::class.java, true) &&
                env.getProperty("spring.servlet.multipart.enabled", Boolean::class.java, true) &&
                !env.getProperty("spring.servlet.multipart.resolve-lazily", Boolean::class.java, false)
    }

    /** Inbound WebFlux requests, annotated controllers and router functions, drawn from the caller to this app. */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.REACTIVE)
    @ConditionalOnClass(name = ["org.springframework.web.server.WebFilter", "reactor.core.publisher.Mono"])
    internal class Reactive {
        @Bean
        public fun lsdWebFilter(env: Environment): WebFilter = LsdWebFilter(ParticipantNames(env))

        /**
         * The reply a failed handler gets from the app's error handling, drawn with its status and
         * body, and the parts of a multipart request (on unless
         * `lsd.mono.spring.multipart.parts.enabled=false`). A decorator factory, so the server's
         * handler and a `WebTestClient` bound to the application context both pick it up.
         */
        @Bean
        public fun lsdErrorReplies(env: Environment): HttpHandlerDecoratorFactory {
            val readParts = ErrorCapturingResponse.readsParts(env)
            return HttpHandlerDecoratorFactory { ErrorCapturingResponse.decorate(it, readParts) }
        }
    }

    /**
     * Requests a `WebTestClient` sends, bound to a server or to the application context, carry the
     * test's scenario, so the app draws them in it even when several tests run at once.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(
        name = [
            "org.springframework.boot.webtestclient.autoconfigure.WebTestClientBuilderCustomizer",
            "org.springframework.test.web.reactive.server.WebTestClient",
        ],
    )
    internal class WebTestClients {
        @Bean
        public fun lsdWebTestClientCustomizer(): WebTestClientBuilderCustomizer =
            WebTestClientBuilderCustomizer { it.filter(LsdWebTestClient.filter()) }
    }

    /**
     * Outbound calls through any `WebClient.Builder` or `WebClient` bean: Boot's builder and ones
     * the app builds itself. Servlet apps that use `WebClient` are covered too.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = ["org.springframework.web.reactive.function.client.WebClient", "reactor.core.publisher.Mono"])
    internal class WebClients {
        companion object {
            @Bean
            @JvmStatic
            public fun lsdWebClientPostProcessor(): BeanPostProcessor = LsdWebClientPostProcessor()
        }
    }

    /**
     * The request a reactive chain serves, restored onto each thread the chain hops to, so the
     * repository calls and Kafka sends made there nest under it (see [LsdContextPropagation]).
     * Needs Micrometer context-propagation on the test classpath; off with
     * `lsd.mono.spring.reactor.context-propagation.enabled=false`.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = ["reactor.core.publisher.Hooks", "io.micrometer.context.ContextRegistry"])
    @ConditionalOnProperty(
        prefix = "lsd.mono.spring.reactor.context-propagation",
        name = ["enabled"],
        havingValue = "true",
        matchIfMissing = true,
    )
    internal class ReactorContextPropagation {
        companion object {
            /** Static and a [BeanFactoryPostProcessor], so it is in place before any bean serves a request. */
            @Bean
            @JvmStatic
            public fun lsdContextPropagation(): BeanFactoryPostProcessor = BeanFactoryPostProcessor { LsdContextPropagation.install() }
        }
    }

    /**
     * WebSockets a servlet app serves (`@EnableWebSocket` handlers and STOMP endpoints): the
     * handshake is drawn by the inbound filter, then each message, the close and errors. STOMP
     * frames are drawn from the broker's client channels, labelled with the payload's class where
     * the app's own code says what it is. Off with `lsd.mono.spring.websocket.enabled=false`.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    @ConditionalOnClass(
        name = [
            "org.springframework.web.socket.server.support.WebSocketHandlerMapping",
            "org.springframework.web.servlet.handler.SimpleUrlHandlerMapping",
        ],
    )
    @ConditionalOnProperty(prefix = "lsd.mono.spring.websocket", name = ["enabled"], havingValue = "true", matchIfMissing = true)
    internal class WebSockets {
        companion object {
            @Bean
            @JvmStatic
            public fun lsdWebSocketPostProcessor(env: Environment): BeanPostProcessor = LsdWebSocketPostProcessor(env)
        }

        @Configuration(proxyBeanMethods = false)
        @ConditionalOnClass(
            name = [
                "org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer",
                "org.springframework.messaging.simp.annotation.support.SimpAnnotationMethodMessageHandler",
            ],
        )
        internal class StompFrames {
            @Bean
            public fun lsdStompConfigurer(handler: ObjectProvider<SimpAnnotationMethodMessageHandler>): WebSocketMessageBrokerConfigurer =
                LsdStompConfigurer(handler)

            companion object {
                @Bean
                @JvmStatic
                public fun lsdStompPostProcessor(): BeanPostProcessor = LsdStompPostProcessor()
            }
        }
    }

    /**
     * Work handed to Spring-managed executors and schedulers (`@Async`, Boot's
     * `applicationTaskExecutor`, executors the app declares) and to plain `ExecutorService` and
     * `ScheduledExecutorService` beans keeps its scenario and the call that handed it over. Off
     * with `lsd.mono.spring.executors.enabled=false`.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = ["org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor"])
    @ConditionalOnProperty(prefix = "lsd.mono.spring.executors", name = ["enabled"], havingValue = "true", matchIfMissing = true)
    internal class Executors {
        companion object {
            @Bean
            @JvmStatic
            public fun lsdExecutorPostProcessor(): BeanPostProcessor = LsdExecutorPostProcessor()

            @Bean
            @JvmStatic
            public fun lsdExecutorServicePostProcessor(): BeanPostProcessor = LsdExecutorServicePostProcessor()
        }
    }

    /**
     * Outbound calls through any `RestClient` or `RestTemplate` built from Boot's builders, and
     * through `RestClient`, `RestClient.Builder`, `RestTemplate` and `RestTemplateBuilder` beans
     * the app builds itself.
     */
    @Configuration(proxyBeanMethods = false)
    @ConditionalOnClass(name = ["org.springframework.boot.restclient.RestClientCustomizer"])
    internal class RestClientsConfig {
        @Bean
        public fun lsdRestClientCustomizer(env: Environment): RestClientCustomizer {
            val interceptor = LsdClientInterceptor(ParticipantNames(env))
            return RestClientCustomizer {
                RestClients.add(it, interceptor)
            }
        }

        @Bean
        public fun lsdRestTemplateCustomizer(env: Environment): RestTemplateCustomizer {
            val interceptor = LsdClientInterceptor(ParticipantNames(env))
            return RestTemplateCustomizer {
                RestClients.add(it, interceptor)
            }
        }

        companion object {
            @Bean
            @JvmStatic
            public fun lsdRestClientPostProcessor(): BeanPostProcessor = LsdRestClientPostProcessor()
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
    internal class Kafka {
        companion object {
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
    internal class Repositories {
        companion object {
            @Bean
            @JvmStatic
            public fun lsdRepositoryPostProcessor(): BeanPostProcessor = LsdRepositoryPostProcessor()
        }
    }
}
