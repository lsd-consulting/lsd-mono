package io.github.lsdconsulting.lsd.mono.jvm

import java.time.Instant

/** What an ingested [Interaction] is. */
public enum class InteractionKind {
    /** A call: drawn as a synchronous arrow. */
    REQUEST,

    /** The reply to a call. */
    RESPONSE,

    /** An asynchronous publish. */
    PUBLISH,

    /** An asynchronous consume, optionally linked to its publish by `replyTo`. */
    CONSUME,

    /** A plain arrow. */
    MESSAGE,
}

/**
 * One interaction from a library that is not a test: an HTTP interceptor, a broker listener, an
 * importer such as lsd-distributed. Everything but [kind] is optional, and lsd-mono degrades
 * gracefully when it is missing (see the timing API notes).
 *
 * @property from the caller or publisher; null only for an inbound edge.
 * @property to the callee or topic; null only for an outbound edge.
 * @property interactionId becomes the `callId` of a REQUEST or PUBLISH; generated when absent.
 * @property replyTo a RESPONSE's request id, or a CONSUME's publish id.
 * @property durationMs measured, fractional ms. On a RESPONSE it belongs to the paired REQUEST.
 *   Zero is treated as absent (importers send 0 for "not measured").
 * @property data the payload body.
 * @property headers protocol headers (HTTP, Kafka record headers). When given, the payload shown is
 *   `{ "headers": …, "body": data }`, the shape the inspector already lays out; redaction applies to
 *   header names as to any map key (`authorization`, `cookie` by default).
 */
public data class Interaction
    @JvmOverloads
    constructor(
        val kind: InteractionKind,
        val from: String?,
        val to: String?,
        val label: String = "",
        val status: String? = null,
        val interactionId: String? = null,
        val replyTo: String? = null,
        val trace: Trace? = null,
        val source: String? = null,
        val startedAt: Instant? = null,
        val durationMs: Double? = null,
        val orderByStartedAt: Boolean? = null,
        val data: Any? = null,
        val headers: Map<String, String>? = null,
    )

/** Accepts interactions from other libraries. Thread-safe, and never throws. */
public fun interface InteractionSink {
    /** Capture [interaction]. */
    public fun accept(interaction: Interaction)
}
