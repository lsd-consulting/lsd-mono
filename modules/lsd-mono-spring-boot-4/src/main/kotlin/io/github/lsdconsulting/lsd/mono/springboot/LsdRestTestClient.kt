package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.Trace
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpRequest
import org.springframework.http.client.ClientHttpRequestExecution
import org.springframework.http.client.ClientHttpRequestInterceptor
import org.springframework.http.client.ClientHttpResponse
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

/**
 * For a `RestTestClient` or `TestRestTemplate` the test builds itself. Spring Boot's
 * auto-configured `RestTestClient` (`@AutoConfigureRestTestClient`) and `TestRestTemplate` need
 * nothing: the starter configures them.
 *
 * ```java
 * RestTestClient client = RestTestClient.bindToController(new OrderController())
 *         .requestInterceptor(LsdRestTestClient.interceptor())
 *         .build();
 *
 * TestRestTemplate template = new TestRestTemplate(
 *         new RestTemplateBuilder().additionalInterceptors(LsdRestTestClient.interceptor()));
 * ```
 *
 * Its requests carry the test's scenario, so they are drawn in it even while several tests run at
 * once. Sent to a server (`bindToServer`, `TestRestTemplate`), the app's own filter draws them, so
 * this only adds `lsd-scenario` (for loopback hosts, or `lsd.mono.propagation.allowedHosts`).
 * Bound in the JVM (`bindTo(mockMvc)`, `bindToApplicationContext`, `bindToController`,
 * `bindToRouterFunction`, with or without a loopback base URL), it draws each request and its reply itself, from the test's client to
 * the app, named from the test's application context as the app's filter names them; when the
 * app's filter is in the chain too, the request is drawn once. Applying it more than once, or to
 * Spring Boot's client, adds nothing: a request already marked by it is passed on as it is.
 */
public object LsdRestTestClient {
    /** Add it with `RestTestClient.Builder.requestInterceptor(...)` or a `RestTemplateBuilder`. */
    @JvmStatic
    public fun interceptor(): ClientHttpRequestInterceptor = Interceptor

    private object Interceptor : ClientHttpRequestInterceptor {
        override fun intercept(
            request: HttpRequest,
            body: ByteArray,
            execution: ClientHttpRequestExecution,
        ): ClientHttpResponse {
            val scenario = guarded(null) { SpringScenarios.resolve() } ?: return execution.execute(request, body)
            val uri = request.uri
            val inJvm =
                uri.host == null ||
                    guarded(false) { SpringScenarios.clientSettingsOf(scenario)?.names?.isLoopbackWithoutServer(uri) == true }
            if (!inJvm) {
                // A server's own filter draws the request; this only says which scenario it is in.
                guarded(Unit) {
                    if (!request.headers.containsHeader(LsdHeaders.SCENARIO)) {
                        scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) }?.let {
                            request.headers.set(LsdHeaders.SCENARIO, it)
                        }
                    }
                }
                return execution.execute(request, body)
            }
            return inJvm(scenario, request, body, execution)
        }

        /**
         * No host, or a loopback host while the test runs no server: the request never leaves the
         * JVM, and may or may not pass the app's filter.
         */
        private fun inJvm(
            scenario: LsdScenario,
            request: HttpRequest,
            body: ByteArray,
            execution: ClientHttpRequestExecution,
        ): ClientHttpResponse {
            // Already drawn by this interceptor further out (applied twice): pass it on.
            if (guarded(null) { ClientDrawnCalls.drawnByClient(request.headers.getFirst(ClientDrawnCalls.HEADER)) } != null) {
                return execution.execute(request, body)
            }
            val id = SpringScenarios.newId()
            val names = guarded(null) { ClientSettings.of(scenario).names } ?: return execution.execute(request, body)
            val parent = SpringScenarios.parentOf(scenario)
            val caller = if (parent == null) names.client else names.app
            val uri = request.uri
            guarded(Unit) {
                request.headers.set(ClientDrawnCalls.HEADER, id)
                val query = uri.rawQuery?.let { "?$it" } ?: ""
                scenario.ingest(
                    Interaction(
                        kind = InteractionKind.REQUEST,
                        from = caller,
                        to = names.app,
                        label = "${request.method} ${uri.rawPath.ifEmpty { "/" }}$query",
                        interactionId = id,
                        trace = Trace(scenario.correlationId, id, parent),
                        source = SpringScenarios.SOURCE,
                        startedAt = Instant.now(),
                        data = Bodies.read(body, request.headers.contentType?.toString()),
                        headers = flatten(request.headers),
                    ),
                )
            }
            val t0 = System.nanoTime()
            ClientDrawnCalls.open(id)
            val response =
                try {
                    execution.execute(request, body)
                } catch (e: Exception) {
                    reply(scenario, id, names.app, caller, t0, "error", e.javaClass.simpleName, e.toString(), null)
                    throw e
                } finally {
                    ClientDrawnCalls.close(id)
                }
            val buffered = guarded<ClientHttpResponse>(response) { BufferedResponse.of(response) }
            guarded(Unit) {
                val code = buffered.statusCode.value()
                val data = (buffered as? BufferedResponse)?.let { Bodies.read(it.bytes, it.headers.contentType?.toString()) }
                reply(scenario, id, names.app, caller, t0, code.toString(), statusLabel(code), data, flatten(buffered.headers))
            }
            return buffered
        }

        private fun reply(
            scenario: LsdScenario,
            id: String,
            from: String,
            to: String,
            t0: Long,
            status: String,
            label: String,
            data: Any?,
            headers: Map<String, String>?,
        ) = guarded(Unit) {
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.RESPONSE,
                    from = from,
                    to = to,
                    label = label,
                    status = status,
                    replyTo = id,
                    source = SpringScenarios.SOURCE,
                    durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                    data = data,
                    headers = headers,
                ),
            )
        }

        private fun flatten(headers: HttpHeaders): Map<String, String> =
            headers
                .headerNames()
                .filterNot(SpringScenarios::isOwnHeader)
                .associateWith { headers.getValuesAsList(it).joinToString(", ") }
    }
}

/**
 * In-JVM calls [LsdRestTestClient] draws itself. The app's filter, meeting one (MockMvc runs it on
 * the caller's thread, while the call is open), serves it under the client's id and draws nothing.
 * Only ids open in this JVM count, so a header from elsewhere cannot silence the filter.
 */
internal object ClientDrawnCalls {
    const val HEADER: String = "lsd-client-drawn"

    private val open = ConcurrentHashMap.newKeySet<String>()

    fun open(id: String) {
        open += id
    }

    fun close(id: String) {
        open -= id
    }

    /** The id of the open call [headerValue] names, or null. */
    fun drawnByClient(headerValue: String?): String? = headerValue?.takeIf { it in open }
}
