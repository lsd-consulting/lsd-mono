package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.http.HttpStatus
import org.springframework.test.web.reactive.server.WebTestClient
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.reactive.function.server.RouterFunctions
import org.springframework.web.reactive.function.server.ServerResponse
import org.springframework.web.server.ResponseStatusException
import reactor.core.publisher.Mono

/** A `WebTestClient` the test builds itself, with [LsdWebTestClient.configurer] and without. */
@LsdTestConfig(deterministicIds = true)
class LsdWebTestClientTest {
    private val started = mutableListOf<LsdScenario>()

    @RestController
    class Orders {
        @GetMapping("/orders/{id}")
        fun order(
            @PathVariable("id") id: String,
        ): Mono<Map<String, String>> =
            if (id == "404") Mono.error(ResponseStatusException(HttpStatus.NOT_FOUND)) else Mono.just(mapOf("order" to id))
    }

    @BeforeEach
    @AfterEach
    fun clear() {
        started.forEach(SpringScenarios::finished)
        started.clear()
        LsdContext.instance.clear()
    }

    /** This test's scenario, bound to its thread, with another test's running alongside it. */
    private fun start(): LsdScenario {
        val other = LsdContext.instance.beginScenario(reportKey = "other", key = "other", bindCurrentThread = false)
        val mine = LsdContext.instance.beginScenario(reportKey = KEY, key = KEY, bindCurrentThread = true)
        return mine.also {
            listOf(other, mine).forEach {
                SpringScenarios.started(it)
                started += it
            }
        }
    }

    private fun report(scenario: LsdScenario): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(KEY)
        return ReportJson.read(LsdContext.instance.completeReport(KEY, KEY).reportJson).scenario(KEY)
    }

    private fun get(
        client: WebTestClient,
        id: String = "7",
    ) = client
        .get()
        .uri("/orders/$id")
        .exchange()
        .expectBody()
        .returnResult()

    @Test
    fun `a client bound to a controller draws its requests in the test's scenario once the configurer is applied`() {
        val scenario = start()
        val client = WebTestClient
            .bindToController(Orders())
            .configureClient()
            .apply(LsdWebTestClient.configurer())
            .build()

        get(client)
        get(client, "404")

        val drawn = report(scenario)
        assertEquals(listOf("GET /orders/7", "200 OK", "GET /orders/404", "404 Not Found"), drawn.labels, drawn.json)
        assertEquals("client", drawn.message("GET /orders/7")["from"], drawn.json)
    }

    @Test
    fun `without the configurer a client bound to a controller is not drawn`() {
        val scenario = start()

        get(WebTestClient.bindToController(Orders()).build())

        assertEquals(emptyList<String>(), report(scenario).labels)
    }

    @Test
    fun `applying the configurer twice, or to a client bound to a router function, draws each request once`() {
        val scenario = start()
        val route = RouterFunctions.route().GET("/orders/{id}") { ServerResponse.ok().bodyValue(mapOf("order" to it.pathVariable("id"))) }.build()
        val client =
            WebTestClient
                .bindToRouterFunction(route)
                .configureClient()
                .apply(LsdWebTestClient.configurer())
                .apply(LsdWebTestClient.configurer())
                .build()

        get(client)
        get(client.mutate().apply(LsdWebTestClient.configurer()).build(), "8")

        val drawn = report(scenario)
        assertEquals(listOf("GET /orders/7", "200 OK", "GET /orders/8", "200 OK"), drawn.labels, drawn.json)
    }

    private companion object {
        const val KEY = "web-test-client"
    }
}
