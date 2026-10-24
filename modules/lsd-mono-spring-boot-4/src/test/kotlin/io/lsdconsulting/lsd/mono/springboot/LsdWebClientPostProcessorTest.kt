package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Test
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.boot.test.context.runner.ReactiveWebApplicationContextRunner
import org.springframework.boot.test.context.runner.WebApplicationContextRunner
import org.springframework.mock.env.MockEnvironment
import org.springframework.web.reactive.function.client.ExchangeFilterFunction
import org.springframework.web.reactive.function.client.WebClient
import org.springframework.web.server.WebFilter

class LsdWebClientPostProcessorTest {
    private val processor = LsdWebClientPostProcessor().apply { setEnvironment(MockEnvironment()) }

    private fun filtersOf(builder: WebClient.Builder): List<ExchangeFilterFunction> {
        val filters = mutableListOf<ExchangeFilterFunction>()
        builder.filters { filters += it }
        return filters
    }

    @Test
    fun `a builder gets our filter once, after the app's own`() {
        val own = ExchangeFilterFunction { request, next -> next.exchange(request) }
        val builder = WebClient.builder().filter(own)
        processor.postProcessAfterInitialization(builder, "builder")
        processor.postProcessAfterInitialization(builder, "builder")
        val filters = filtersOf(builder)
        assertEquals(2, filters.size)
        assertSame(own, filters[0])
        assertEquals(LsdExchangeFilter::class.java, filters[1]::class.java)
    }

    @Test
    fun `a WebClient bean is rebuilt with our filter, one that has it already is kept, anything else is left alone`() {
        val plain = WebClient.create("http://inventory")
        val rebuilt = processor.postProcessAfterInitialization(plain, "inventory") as WebClient
        assertNotSame(plain, rebuilt)
        assertEquals(1, filtersOf(rebuilt.mutate()).count { it is LsdExchangeFilter })
        assertSame(rebuilt, processor.postProcessAfterInitialization(rebuilt, "inventory"))
        val other = Any()
        assertSame(other, processor.postProcessAfterInitialization(other, "other"))
    }

    private val autoConfig = AutoConfigurations.of(LsdAutoConfiguration::class.java)

    @Test
    fun `a reactive app gets the WebFlux filter and no servlet one, unless the starter is switched off`() {
        ReactiveWebApplicationContextRunner().withConfiguration(autoConfig).run {
            assertEquals(1, it.getBeansOfType(WebFilter::class.java).size)
            assertEquals(false, it.containsBean("lsdInboundFilter"))
            assertEquals(1, it.getBeanNamesForType(LsdWebClientPostProcessor::class.java).size)
        }
        ReactiveWebApplicationContextRunner()
            .withConfiguration(autoConfig)
            .withPropertyValues("lsd.mono.spring.enabled=false")
            .run {
                assertEquals(0, it.getBeansOfType(WebFilter::class.java).size)
                assertEquals(0, it.getBeanNamesForType(LsdWebClientPostProcessor::class.java).size)
            }
    }

    @Test
    fun `a servlet app keeps its servlet filter and gets no WebFlux one`() {
        WebApplicationContextRunner().withConfiguration(autoConfig).run {
            assertEquals(0, it.getBeansOfType(WebFilter::class.java).size)
            assertEquals(1, it.getBeanNamesForType(LsdWebClientPostProcessor::class.java).size)
        }
        ApplicationContextRunner().withConfiguration(autoConfig).run {
            assertEquals(0, it.getBeansOfType(WebFilter::class.java).size)
        }
    }
}
