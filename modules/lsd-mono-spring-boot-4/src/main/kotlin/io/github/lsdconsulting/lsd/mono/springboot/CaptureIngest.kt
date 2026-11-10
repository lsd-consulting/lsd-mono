package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.http.HttpHeaders
import java.net.URI

/**
 * The scenario header (and, when [caller] is set, the caller and parent span) for an outgoing call.
 * [onlyIfMissing] leaves an existing scenario header in place, as [LsdRestTestClient] does for a
 * request the server filter will draw.
 */
internal fun propagateScenarioHeaders(
    headers: HttpHeaders,
    uri: URI,
    scenario: LsdScenario,
    caller: String? = null,
    parent: String? = null,
    onlyIfMissing: Boolean = false,
): String? {
    if (onlyIfMissing && headers.containsHeader(LsdHeaders.SCENARIO)) return headers.getFirst(LsdHeaders.SCENARIO)
    val allowed = scenario.bind().use { LsdContext.instance.scenarioHeaderValue(uri) } ?: return null
    headers.set(LsdHeaders.SCENARIO, allowed)
    if (caller != null) {
        headers.set(SpringScenarios.CALLER_HEADER, caller)
        parent?.let { headers.set(LsdInboundFilter.PARENT_SPAN_HEADER, it) }
    }
    return allowed
}

/** Draw a RESPONSE for a captured call: status, optional headers, and how long it took. */
internal fun ingestReply(
    scenario: LsdScenario,
    from: String,
    to: String,
    id: String,
    status: String,
    label: String,
    data: Any?,
    t0: Long,
    headers: Map<String, String>? = null,
) = guarded(Unit) {
    scenario.ingest(
        Interaction
            .builder(InteractionKind.RESPONSE, from, to, label)
            .status(status)
            .replyTo(id)
            .source(SpringScenarios.SOURCE)
            .durationMs((System.nanoTime() - t0) / 1_000_000.0)
            .data(data)
            .headers(headers)
            .build(),
    )
}
