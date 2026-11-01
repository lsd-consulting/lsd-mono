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
 * One interaction from a library: an HTTP interceptor, a broker listener, or an
 * importer such as lsd-distributed. Everything but [kind] and [label] is optional, and lsd-mono degrades
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
public data class Interaction(
    public val kind: InteractionKind,
    public val from: String? = null,
    public val to: String? = null,
    public val label: String,
    public val status: String? = null,
    public val interactionId: String? = null,
    public val replyTo: String? = null,
    public val trace: Trace? = null,
    public val source: String? = null,
    public val startedAt: Instant? = null,
    public val durationMs: Double? = null,
    public val orderByStartedAt: Boolean? = null,
    public val data: Any? = null,
    public val headers: Map<String, String>? = null,
) {
    /** A builder holding this interaction's values, to make a changed copy. */
    @Deprecated(
        message = "Use .copy() instead if you are using Kotlin.",
        level = DeprecationLevel.WARNING,
    )
    public fun toBuilder(): Builder =
        Builder()
            .kind(kind)
            .from(from)
            .to(to)
            .label(label)
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

    override fun toString(): String = describe("Interaction", fields())

    private fun fields(): Map<String, Any?> =
        mapOf(
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

    /** Companion object */
    public companion object {
        /**
         * Builder for [Interaction].
         *
         * To be used by Java libraries. Kotlin user should leverage [Interaction] with data class capabilities instead.
         */
        public class Builder @JvmOverloads internal constructor(
            private var kind: InteractionKind? = null,
            private var from: String? = null,
            private var to: String? = null,
            private var label: String? = null,
            private var status: String? = null,
            private var interactionId: String? = null,
            private var replyTo: String? = null,
            private var trace: Trace? = null,
            private var source: String? = null,
            private var startedAt: Instant? = null,
            private var durationMs: Double? = null,
            private var orderByStartedAt: Boolean? = null,
            private var data: Any? = null,
            private var headers: Map<String, String>? = null,
        ) {
            /** set [kind] */
            public fun kind(kind: InteractionKind): Builder = apply { this.kind = kind }

            /** set [from] */
            public fun from(from: String?): Builder = apply { this.from = from }

            /** set [to] */
            public fun to(to: String?): Builder = apply { this.to = to }

            /** set [label] */
            public fun label(label: String): Builder = apply { this.label = label }

            /** set [status] */
            public fun status(status: String?): Builder = apply { this.status = status }

            /** set [interactionId] */
            public fun interactionId(interactionId: String?): Builder = apply { this.interactionId = interactionId }

            /** set [replyTo] */
            public fun replyTo(replyTo: String?): Builder = apply { this.replyTo = replyTo }

            /** set [trace] */
            public fun trace(trace: Trace?): Builder = apply { this.trace = trace }

            /** set [source] */
            public fun source(source: String?): Builder = apply { this.source = source }

            /** set [startedAt] */
            public fun startedAt(startedAt: Instant?): Builder = apply { this.startedAt = startedAt }

            /** set [durationMs] */
            public fun durationMs(durationMs: Double?): Builder = apply { this.durationMs = durationMs }

            /** set [orderByStartedAt] */
            public fun orderByStartedAt(orderByStartedAt: Boolean?): Builder = apply { this.orderByStartedAt = orderByStartedAt }

            /** set [data] */
            public fun data(data: Any?): Builder = apply { this.data = data }

            /** set [headers] */
            public fun headers(headers: Map<String, String>?): Builder = apply { this.headers = headers }

            /** Create [Interaction] */
            @Deprecated(
                message = "Use Interaction constructor instead if using Kotlin",
                level = DeprecationLevel.ERROR,
            )
            public fun build(): Interaction =
                Interaction(
                    kind = kind!!,
                    from = from,
                    to = to,
                    label = label!!,
                    status = status,
                    interactionId = interactionId,
                    replyTo = replyTo,
                    trace = trace,
                    source = source,
                    startedAt = startedAt,
                    durationMs = durationMs,
                    orderByStartedAt = orderByStartedAt,
                    data = data,
                    headers = headers,
                )
        }

        /** Builder object for [Interaction] */
        @Deprecated(
            message = "Use Interaction constructor instead if using Kotlin",
            level = DeprecationLevel.ERROR,
        )
        public fun builder(): Builder = Builder()
    }
}

/** Accepts interactions from other libraries. Thread-safe, and never throws. */
public fun interface InteractionSink {
    /** Capture [interaction]. */
    public fun accept(interaction: Interaction)
}
