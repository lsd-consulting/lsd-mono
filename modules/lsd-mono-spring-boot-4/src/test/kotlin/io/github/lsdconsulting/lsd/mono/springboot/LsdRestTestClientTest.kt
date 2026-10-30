package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpMethod
import org.springframework.http.HttpRequest
import org.springframework.http.HttpStatus
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.http.client.MockClientHttpRequest
import org.springframework.mock.http.client.MockClientHttpResponse
import java.io.IOException
import java.net.URI

/** The RestTestClient interceptor against a stub execution: what it draws, and what it sends. */
@LsdTestConfig(deterministicIds = true)
class LsdRestTestClientTest {
    private val interceptor = LsdRestTestClient.interceptor()
    private var scenario: LsdScenario? = null

    /** What the execution was handed, and what it saw open while it ran. */
    private var sent: HttpRequest? = null
    private var openWhileRunning: String? = null

    @BeforeEach
    @AfterEach
    fun clear() {
        scenario?.let(SpringScenarios::finished)
        scenario = null
        LsdContext.instance.clear()
    }

    private fun start(serverPort: Int? = null): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = "rtc", key = "rtc-test").also {
            val env = MockEnvironment().withProperty("spring.application.name", "shop")
            serverPort?.let { port -> env.setProperty("local.server.port", port.toString()) }
            SpringScenarios.started(it, env)
            scenario = it
        }

    private fun report(scenario: LsdScenario): ScenarioJson {
        SpringScenarios.finished(scenario)
        this.scenario = null
        scenario.complete("calls the app")
        return ReportJson.read(LsdContext.instance.completeReport("rtc", "rtc").reportJson).scenario("calls the app")
    }

    private fun ScenarioJson.drawn() = messages.map { "${it["from"]}->${it["to"]}: ${it["label"]}" }

    private fun request(
        uri: String,
        vararg headers: Pair<String, String>,
    ) = MockClientHttpRequest(HttpMethod.GET, URI.create(uri)).apply { headers.forEach { (k, v) -> this.headers.add(k, v) } }

    private val ok =
        ClientHttpRequestExecution { request, _ ->
            sent = request
            openWhileRunning = ClientDrawnCalls.drawnByClient(request.headers.getFirst(ClientDrawnCalls.HEADER))
            MockClientHttpResponse(ByteArray(0), HttpStatus.OK)
        }

    @Test
    fun `an in-JVM call is drawn with its query, and its id is open only while it runs`() {
        val scenario = start()

        interceptor.intercept(request("/orders/1?expand=lines"), ByteArray(0), ok)

        val id = sent!!.headers.getFirst(ClientDrawnCalls.HEADER)
        assertNotNull(id)
        assertEquals(id, openWhileRunning, "the app's filter sees the call open while it runs")
        assertNull(ClientDrawnCalls.drawnByClient(id), "closed once the call returns")
        assertEquals(listOf("client->shop: GET /orders/1?expand=lines", "shop->client: 200 OK"), report(scenario).drawn())
    }

    @Test
    fun `applied twice, an in-JVM call is drawn once`() {
        val scenario = start()

        interceptor.intercept(request("/orders/2"), ByteArray(0)) { inner, body -> interceptor.intercept(inner, body, ok) }

        assertEquals(listOf("client->shop: GET /orders/2", "shop->client: 200 OK"), report(scenario).drawn())
    }

    @Test
    fun `a call that throws is drawn as an error reply, closed, and rethrown`() {
        val scenario = start()
        var id: String? = null

        val thrown =
            assertThrows(IOException::class.java) {
                interceptor.intercept(request("/orders/3"), ByteArray(0)) { request, _ ->
                    id = request.headers.getFirst(ClientDrawnCalls.HEADER)
                    throw IOException("connection reset")
                }
            }

        assertEquals("connection reset", thrown.message)
        assertNull(ClientDrawnCalls.drawnByClient(id), "closed after a failure too")
        val drawn = report(scenario)
        assertEquals(listOf("client->shop: GET /orders/3", "shop->client: IOException"), drawn.drawn())
        assertEquals("error", drawn.message("IOException")["status"], drawn.json)
    }

    @Test
    fun `a call made while the app serves a request is drawn from the app`() {
        val scenario = start()

        SpringScenarios.within(SpringScenarios.Current(scenario, "serving")) {
            interceptor.intercept(request("/orders/4"), ByteArray(0), ok)
        }

        assertEquals(listOf("shop->shop: GET /orders/4", "shop->shop: 200 OK"), report(scenario).drawn())
    }

    @Test
    fun `the starter's own headers are left out of the drawing, the test's are kept`() {
        val scenario = start()

        interceptor.intercept(request("/orders/5", "X-Trace" to "abc", "lsd-other" to "x"), ByteArray(0), ok)

        val headers = report(scenario).message("GET /orders/5").obj("data")?.obj("headers")
        assertEquals("abc", headers?.string("X-Trace"), headers?.source)
        assertFalse(headers?.source.orEmpty().contains("lsd-", ignoreCase = true), headers?.source)
    }

    @Test
    fun `an id that is not open does not silence the app's filter`() {
        assertNull(ClientDrawnCalls.drawnByClient("forged"))
        assertNull(ClientDrawnCalls.drawnByClient(null))
        ClientDrawnCalls.open("real")
        try {
            assertEquals("real", ClientDrawnCalls.drawnByClient("real"))
        } finally {
            ClientDrawnCalls.close("real")
        }
        assertNull(ClientDrawnCalls.drawnByClient("real"), "a stale id counts for nothing")
    }

    @Test
    fun `a stale id on an in-JVM request does not stop it being drawn`() {
        val scenario = start()

        interceptor.intercept(request("/orders/6", ClientDrawnCalls.HEADER to "stale"), ByteArray(0), ok)

        assertEquals(listOf("client->shop: GET /orders/6", "shop->client: 200 OK"), report(scenario).drawn())
    }

    @Test
    fun `to a loopback server it only adds the scenario, keeping one the test set`() {
        val scenario = start(serverPort = 8080)

        interceptor.intercept(request("http://localhost:8080/orders/7"), ByteArray(0), ok)
        assertNotNull(sent!!.headers.getFirst(LsdHeaders.SCENARIO))
        assertNull(sent!!.headers.getFirst(ClientDrawnCalls.HEADER))

        interceptor.intercept(request("http://localhost:8080/orders/8", LsdHeaders.SCENARIO to "mine"), ByteArray(0), ok)
        assertEquals(listOf("mine"), sent!!.headers[LsdHeaders.SCENARIO])

        assertTrue(report(scenario).messages.isEmpty(), "the server's filter draws it")
    }

    @Test
    fun `to a loopback host with no server running it draws the call itself`() {
        val scenario = start()

        interceptor.intercept(request("http://localhost/orders/10"), ByteArray(0), ok)

        assertNotNull(sent!!.headers.getFirst(ClientDrawnCalls.HEADER))
        assertEquals(listOf("client->shop: GET /orders/10", "shop->client: 200 OK"), report(scenario).drawn())
    }

    @Test
    fun `to another host it adds nothing and draws nothing`() {
        val scenario = start()
        val request = request("http://pricing.example.com/quotes")

        val response = interceptor.intercept(request, ByteArray(0), ok)

        assertSame(request, sent)
        assertEquals(HttpStatus.OK, response.statusCode)
        assertFalse(sent!!.headers.headerNames().any { it.startsWith("lsd-", ignoreCase = true) }, sent!!.headers.toString())
        assertTrue(report(scenario).messages.isEmpty())
    }

    @Test
    fun `with no scenario running it passes the request on untouched`() {
        val request = request("/orders/9")

        interceptor.intercept(request, ByteArray(0), ok)

        assertEquals(HttpHeaders.EMPTY.headerNames(), sent!!.headers.headerNames())
    }
}
