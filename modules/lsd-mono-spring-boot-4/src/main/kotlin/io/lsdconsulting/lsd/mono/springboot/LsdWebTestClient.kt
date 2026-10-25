package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.web.reactive.function.client.ClientRequest
import org.springframework.web.reactive.function.client.ExchangeFilterFunction
import java.net.URI

/**
 * Puts the test's scenario on each request a `WebTestClient` sends, in `lsd-scenario`. The app's
 * own filter draws the request, from `Client`, as it does any the test makes; this only makes sure
 * it lands in the right scenario. Bound to the application context, the request never leaves the
 * JVM, so it always carries the scenario; bound to a server, only to loopback hosts (or
 * `lsd.mono.propagation.allowedHosts`), as the starter's other clients do.
 */
internal object LsdWebTestClient {
    fun filter(): ExchangeFilterFunction =
        ExchangeFilterFunction { request, next ->
            val header =
                guarded(null) {
                    if (request.headers().containsHeader(LsdHeaders.SCENARIO)) null else scenarioFor(request.url())
                }
            next.exchange(if (header == null) request else ClientRequest.from(request).header(LsdHeaders.SCENARIO, header).build())
        }

    private fun scenarioFor(uri: URI): String? {
        val scenario = SpringScenarios.resolve() ?: return null
        if (uri.host == null) return scenario.correlationId
        return scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) }
    }
}
