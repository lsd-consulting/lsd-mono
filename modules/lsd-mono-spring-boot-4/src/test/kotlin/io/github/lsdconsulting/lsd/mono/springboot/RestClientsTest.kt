package io.github.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.boot.restclient.RestTemplateBuilder
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.mock.env.MockEnvironment
import org.springframework.web.client.RestClient
import org.springframework.web.client.RestTemplate

class RestClientsTest {
    private val processor = LsdRestClientPostProcessor().apply { setEnvironment(MockEnvironment()) }
    private val audit = ClientHttpRequestInterceptor { request, body, execution -> execution.execute(request, body) }

    private fun ours(interceptors: List<ClientHttpRequestInterceptor>) = interceptors.count { it is LsdClientInterceptor }

    @Test
    fun `a RestTemplate made with new gets the interceptor once, after the app's`() {
        val template = RestTemplate().apply { interceptors = listOf(audit) }

        processor.postProcessAfterInitialization(template, "inventory")
        processor.postProcessAfterInitialization(template, "inventory")

        assertSame(audit, template.interceptors.first())
        assertEquals(1, ours(template.interceptors))
    }

    @Test
    fun `a RestClient from RestClient builder is rebuilt with the interceptor, and left alone once it has it`() {
        val client = processor.postProcessAfterInitialization(RestClient.builder().build(), "pricing") as RestClient

        assertTrue(RestClients.has(client))
        assertSame(client, processor.postProcessAfterInitialization(client, "pricing"))
    }

    @Test
    fun `a RestClient builder bean gets the interceptor once`() {
        val builder = RestClient.builder()

        processor.postProcessAfterInitialization(builder, "builder")
        processor.postProcessAfterInitialization(builder, "builder")

        var count = 0
        builder.requestInterceptors { count = ours(it) }
        assertEquals(1, count)
    }

    @Test
    fun `a RestTemplateBuilder the app declares builds templates with the interceptor`() {
        val builder = processor.postProcessAfterInitialization(RestTemplateBuilder(), "restTemplateBuilder") as RestTemplateBuilder

        assertEquals(1, ours(builder.build().interceptors))
    }
}
