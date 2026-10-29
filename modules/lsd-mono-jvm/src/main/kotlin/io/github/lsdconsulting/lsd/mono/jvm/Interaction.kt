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
 * Made with [Interaction.builder]; change a copy with [toBuilder] or a `with…` method.
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
public class Interaction private constructor(
    public val kind: InteractionKind,
    public val from: String?,
    public val to: String?,
    public val label: String,
    public val status: String?,
    public val interactionId: String?,
    public val replyTo: String?,
    public val trace: Trace?,
    public val source: String?,
    public val startedAt: Instant?,
    public val durationMs: Double?,
    public val orderByStartedAt: Boolean?,
    public val data: Any?,
    public val headers: Map<String, String>?,
) {
    /** A builder holding this interaction's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(kind, from, to, label)
            .status(status)
            .interactionId(interactionId)
            .replyTo(replyTo)
            .trace(trace)
            .source(source)
            .startedAt(startedAt)
            .durationMs(durationMs)
            .orderByStartedAt(orderByStartedAt)
            .data(data)
            .headers(headers)

    /** A copy with [kind] set. */
    public fun withKind(kind: InteractionKind): Interaction = toBuilder().kind(kind).build()

    /** A copy with [from] set. */
    public fun withFrom(from: String?): Interaction = toBuilder().from(from).build()

    /** A copy with [to] set. */
    public fun withTo(to: String?): Interaction = toBuilder().to(to).build()

    /** A copy with [label] set. */
    public fun withLabel(label: String): Interaction = toBuilder().label(label).build()

    /** A copy with [status] set. */
    public fun withStatus(status: String?): Interaction = toBuilder().status(status).build()

    /** A copy with [interactionId] set. */
    public fun withInteractionId(interactionId: String?): Interaction = toBuilder().interactionId(interactionId).build()

    /** A copy with [replyTo] set. */
    public fun withReplyTo(replyTo: String?): Interaction = toBuilder().replyTo(replyTo).build()

    /** A copy with [trace] set. */
    public fun withTrace(trace: Trace?): Interaction = toBuilder().trace(trace).build()

    /** A copy with [source] set. */
    public fun withSource(source: String?): Interaction = toBuilder().source(source).build()

    /** A copy with [startedAt] set. */
    public fun withStartedAt(startedAt: Instant?): Interaction = toBuilder().startedAt(startedAt).build()

    /** A copy with [durationMs] set. */
    public fun withDurationMs(durationMs: Double?): Interaction = toBuilder().durationMs(durationMs).build()

    /** A copy with [orderByStartedAt] set. */
    public fun withOrderByStartedAt(orderByStartedAt: Boolean?): Interaction = toBuilder().orderByStartedAt(orderByStartedAt).build()

    /** A copy with [data] set. */
    public fun withData(data: Any?): Interaction = toBuilder().data(data).build()

    /** A copy with [headers] set. */
    public fun withHeaders(headers: Map<String, String>?): Interaction = toBuilder().headers(headers).build()

    override fun equals(other: Any?): Boolean = other is Interaction && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("Interaction", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "kind" to kind,
            "from" to from,
            "to" to to,
            "label" to label,
            "status" to status,
            "interactionId" to interactionId,
            "replyTo" to replyTo,
            "trace" to trace,
            "source" to source,
            "startedAt" to startedAt,
            "durationMs" to durationMs,
            "orderByStartedAt" to orderByStartedAt,
            "data" to data,
            "headers" to headers,
        )

    /** Makes an [Interaction]. Every field but the four given to [Interaction.builder] is null until set. */
    public class Builder internal constructor(
        private var kind: InteractionKind,
        private var from: String?,
        private var to: String?,
        private var label: String,
    ) {
        private var status: String? = null
        private var interactionId: String? = null
        private var replyTo: String? = null
        private var trace: Trace? = null
        private var source: String? = null
        private var startedAt: Instant? = null
        private var durationMs: Double? = null
        private var orderByStartedAt: Boolean? = null
        private var data: Any? = null
        private var headers: Map<String, String>? = null

        public fun kind(value: InteractionKind): Builder = apply { kind = value }

        public fun from(value: String?): Builder = apply { from = value }

        public fun to(value: String?): Builder = apply { to = value }

        public fun label(value: String): Builder = apply { label = value }

        public fun status(value: String?): Builder = apply { status = value }

        public fun interactionId(value: String?): Builder = apply { interactionId = value }

        public fun replyTo(value: String?): Builder = apply { replyTo = value }

        public fun trace(value: Trace?): Builder = apply { trace = value }

        public fun source(value: String?): Builder = apply { source = value }

        public fun startedAt(value: Instant?): Builder = apply { startedAt = value }

        public fun durationMs(value: Double?): Builder = apply { durationMs = value }

        public fun orderByStartedAt(value: Boolean?): Builder = apply { orderByStartedAt = value }

        public fun data(value: Any?): Builder = apply { data = value }

        public fun headers(value: Map<String, String>?): Builder = apply { headers = value }

        /** The interaction. */
        public fun build(): Interaction =
            Interaction(kind, from, to, label, status, interactionId, replyTo, trace, source, startedAt, durationMs, orderByStartedAt, data, headers)
    }

    /** Factory. */
    public companion object {
        /** A builder for a [kind] interaction from [from] to [to], labelled [label]. */
        @JvmStatic
        @JvmOverloads
        public fun builder(
            kind: InteractionKind,
            from: String?,
            to: String?,
            label: String = "",
        ): Builder = Builder(kind, from, to, label)
    }
}

/** Accepts interactions from other libraries. Thread-safe, and never throws. */
public fun interface InteractionSink {
    /** Capture [interaction]. */
    public fun accept(interaction: Interaction)
}
