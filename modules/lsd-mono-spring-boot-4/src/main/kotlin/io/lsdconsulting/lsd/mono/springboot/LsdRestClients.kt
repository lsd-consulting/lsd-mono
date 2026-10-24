package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.boot.restclient.RestTemplateBuilder
import org.springframework.boot.restclient.RestTemplateCustomizer
import org.springframework.context.EnvironmentAware
import org.springframework.core.env.Environment
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestTemplate

/** Adds [LsdClientInterceptor] to a client once, whichever way it reaches the starter. */
internal object RestClients {
    fun has(interceptors: List<ClientHttpRequestInterceptor>): Boolean = interceptors.any { it is LsdClientInterceptor }

    fun add(
        builder: RestClient.Builder,
        interceptor: LsdClientInterceptor,
    ) {
        builder.requestInterceptors { if (!has(it)) it.add(interceptor) }
    }

    fun add(
        template: RestTemplate,
        interceptor: LsdClientInterceptor,
    ) {
        // Set, not added in place, so the template drops the request factory it built for the old list.
        if (!has(template.interceptors)) template.interceptors = template.interceptors + interceptor
    }

    fun has(client: RestClient): Boolean {
        var found = false
        client.mutate().requestInterceptors { found = has(it) }
        return found
    }
}

/**
 * Covers the clients an app builds itself, as long as they are beans: a `RestClient` or
 * `RestClient.Builder` from `RestClient.builder()`, a `RestTemplate` made with `new`, and a
 * `RestTemplateBuilder` the app declares (Spring Boot then backs off its own, and with it the
 * customizers). Each gets [LsdClientInterceptor] once; a client built from Spring Boot's builders
 * already has it. A client built inline and never a bean is not seen.
 */
internal class LsdRestClientPostProcessor :
    BeanPostProcessor,
    EnvironmentAware {
    private lateinit var env: Environment
    private val interceptor by lazy { LsdClientInterceptor(ParticipantNames(env)) }

    override fun setEnvironment(environment: Environment) {
        env = environment
    }

    override fun postProcessAfterInitialization(
        bean: Any,
        beanName: String,
    ): Any =
        guarded(bean) {
            when (bean) {
                is RestClient.Builder -> bean.also { RestClients.add(it, interceptor) }
                is RestClient -> if (RestClients.has(bean)) bean else bean.mutate().also { RestClients.add(it, interceptor) }.build()
                is RestTemplate -> bean.also { RestClients.add(it, interceptor) }
                is RestTemplateBuilder -> bean.additionalCustomizers(RestTemplateCustomizer { RestClients.add(it, interceptor) })
                else -> bean
            }
        }
}
