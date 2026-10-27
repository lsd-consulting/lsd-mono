package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.core.env.Environment
import org.springframework.http.HttpStatus
import org.springframework.http.client.MultipartBodyBuilder
import org.springframework.mock.env.MockEnvironment
import org.springframework.test.web.reactive.server.WebTestClient
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.reactive.function.BodyInserters
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

    /**
     * This test's scenario, bound to its thread, with another test's running alongside it; started,
     * as the test listener starts it, with its test context's [environment] (null: outside one).
     */
    private fun start(environment: Environment? = shop()): LsdScenario {
        val other = LsdContext.instance.beginScenario(reportKey = "other", key = "other", bindCurrentThread = false)
        val mine = LsdContext.instance.beginScenario(reportKey = KEY, key = KEY, bindCurrentThread = true)
        return mine.also {
            listOf(other, mine).forEach {
                SpringScenarios.started(it, environment)
                started += it
            }
        }
    }

    private fun shop(): MockEnvironment =
        MockEnvironment()
            .withProperty("spring.application.name", "shop")
            .withProperty("lsd.mono.spring.client-name", "Tester")

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
        assertEquals("tester", drawn.message("GET /orders/7")["from"], drawn.json)
        assertEquals("shop", drawn.message("GET /orders/7")["to"], drawn.json)
        assertEquals("shop", drawn.message("404 Not Found")["from"], drawn.json)
    }

    @Test
    fun `the app's name is the test context's, whichever environment the client was built in`() {
        val client = WebTestClient
            .bindToController(Orders())
            .configureClient()
            .apply(LsdWebTestClient.configurer())
            .build()
        val scenario = start(MockEnvironment().withProperty("lsd.mono.spring.app-name", "Order desk"))

        get(client)

        val drawn = report(scenario)
        assertEquals("Order desk", drawn.participant(drawn.message("GET /orders/7")["to"] as String)["name"], drawn.json)
    }

    @Test
    fun `outside a Spring test the client is drawn with the default names`() {
        val scenario = start(environment = null)

        get(
            WebTestClient
                .bindToController(Orders())
                .configureClient()
                .apply(LsdWebTestClient.configurer())
                .build(),
        )

        val drawn = report(scenario)
        assertEquals("client", drawn.message("GET /orders/7")["from"], drawn.json)
        assertEquals("app", drawn.message("GET /orders/7")["to"], drawn.json)
    }

    @Test
    fun `a multipart request is drawn as its parts unless the test context turns parts off`() {
        val route =
            RouterFunctions
                .route()
                .POST("/documents") { request -> request.multipartData().flatMap { ServerResponse.ok().bodyValue(mapOf("parts" to it.size)) } }
                .build()
        val client = WebTestClient
            .bindToRouterFunction(route)
            .configureClient()
            .apply(LsdWebTestClient.configurer())
            .build()

        fun upload(environment: Environment): ScenarioJson {
            val scenario = start(environment)
            val parts = MultipartBodyBuilder().apply { part("note", "leave at the door") }.build()
            client
                .post()
                .uri("/documents")
                .body(BodyInserters.fromMultipartData(parts))
                .exchange()
                .expectStatus()
                .isOk
            return report(scenario).also { clear() }
        }

        val read = upload(shop())
        val drawnParts = read
            .message("POST /documents")
            .obj("data")
            ?.obj("body")
            ?.objects("parts")
            .orEmpty()
        assertEquals(listOf("note"), drawnParts.map { it["name"] }, read.json)

        val unread = upload(shop().withProperty("lsd.mono.spring.multipart.parts.enabled", "false"))
        assertNull(unread.message("POST /documents").obj("data")?.obj("body"), unread.json)
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
