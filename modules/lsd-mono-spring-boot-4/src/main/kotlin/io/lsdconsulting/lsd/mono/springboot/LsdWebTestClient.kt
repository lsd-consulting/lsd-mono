package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.core.env.Environment
import org.springframework.core.env.StandardEnvironment
import org.springframework.http.client.reactive.ClientHttpConnector
import org.springframework.test.web.reactive.server.WebTestClient
import org.springframework.test.web.reactive.server.WebTestClientConfigurer
import org.springframework.web.reactive.function.client.ClientRequest
import org.springframework.web.reactive.function.client.ClientResponse
import org.springframework.web.reactive.function.client.ExchangeFilterFunction
import org.springframework.web.reactive.function.client.ExchangeFunction
import org.springframework.web.server.adapter.WebHttpHandlerBuilder
import reactor.core.publisher.Mono
import java.net.URI

/**
 * For a `WebTestClient` the test builds itself. Spring Boot's auto-configured one
 * (`@AutoConfigureWebTestClient`) needs nothing: the starter configures it.
 *
 * ```java
 * WebTestClient client = WebTestClient.bindToController(new OrderController())
 *         .configureClient()
 *         .apply(LsdWebTestClient.configurer())
 *         .build();
 * ```
 *
 * Its requests carry the test's scenario, so they are drawn in it even while several tests run at
 * once. Bound to a controller, router function or web handler, where the app's own filters are
 * not in the chain, it also draws the requests itself, naming the app and the test's client as the
 * app's own filter does: from the test's application context (`spring.application.name`,
 * `lsd.mono.spring.app-name`, `lsd.mono.spring.client-name`), as are its other `lsd.mono.spring.*`
 * settings. Applying it more than once, or to a client that already has it, adds nothing.
 */
public object LsdWebTestClient {
    /** Apply it with `WebTestClient.Builder.apply(...)`. */
    @JvmStatic
    public fun configurer(): WebTestClientConfigurer = Configurer

    /** What the starter adds to Spring Boot's `WebTestClient`, and [configurer] to any other. */
    internal fun filter(): ExchangeFilterFunction = ScenarioFilter

    /**
     * Puts the test's scenario on each request, in `lsd-scenario`. The app's own filter draws the
     * request, from `Client`, as it does any the test makes; this only makes sure it lands in the
     * right scenario. Bound to the application context (or a controller), the request never leaves
     * the JVM, so it always carries the scenario; bound to a server, only to loopback hosts (or
     * `lsd.mono.propagation.allowedHosts`), as the starter's other clients do.
     */
    private object ScenarioFilter : ExchangeFilterFunction {
        override fun filter(
            request: ClientRequest,
            next: ExchangeFunction,
        ): Mono<ClientResponse> {
            val header =
                guarded(null) {
                    if (request.headers().containsHeader(LsdHeaders.SCENARIO)) null else scenarioFor(request.url())
                }
            return next.exchange(if (header == null) request else ClientRequest.from(request).header(LsdHeaders.SCENARIO, header).build())
        }

        private fun scenarioFor(uri: URI): String? {
            val scenario = SpringScenarios.resolve() ?: return null
            if (uri.host == null) return scenario.correlationId
            return scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) }
        }
    }

    private object Configurer : WebTestClientConfigurer {
        override fun afterConfigurerAdded(
            builder: WebTestClient.Builder,
            httpHandlerBuilder: WebHttpHandlerBuilder?,
            connector: ClientHttpConnector?,
        ) {
            builder.filters { filters -> if (ScenarioFilter !in filters) filters.add(ScenarioFilter) }
            // Bound to the application context the starter's own filter is already there; bound to
            // a controller, router function or web handler, nothing would draw the request.
            httpHandlerBuilder?.let { handler ->
                var added = false
                handler.filters { filters ->
                    if (filters.none { it is LsdWebFilter }) {
                        filters.add(0, LsdWebFilter { ClientSettings.of(it).names })
                        added = true
                    }
                }
                if (added) handler.httpHandlerDecorator { ErrorCapturingResponse.decorate(it) { scenario -> ClientSettings.of(scenario).readParts } }
            }
        }
    }
}

/**
 * What a client built outside the app's context draws with: the settings of the Spring test that
 * started the scenario, held with that scenario (see [SpringScenarios.clientSettingsOf]) and looked
 * up per request, since the client may be built before the test's scenario begins. Outside a
 * Spring test, system properties and environment variables, read once, on the first such request:
 * a system property set after that is not seen.
 */
internal class ClientSettings(
    env: Environment,
) {
    val names = ParticipantNames(env)
    val readParts = ErrorCapturingResponse.readsParts(env)
    val shown: Int = env.getProperty("lsd.mono.spring.websocket.messages-shown", Int::class.java, WsDrawing.DEFAULT_SHOWN)

    companion object {
        private val fallback by lazy { ClientSettings(StandardEnvironment()) }

        fun of(scenario: LsdScenario): ClientSettings = SpringScenarios.clientSettingsOf(scenario) ?: fallback
    }
}
