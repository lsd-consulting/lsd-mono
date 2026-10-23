package io.lsdconsulting.lsd.mono.report.model

/**
 * Something that happened in a scenario, drawn as one row of the diagram. Each kind is a
 * subclass, made with its `builder`; every event has an [id], unique within its scenario, and may
 * have a [startedAt] time by its source's clock (an RFC 3339 date-time with `Z` or an offset). When
 * any event of a scenario has one, the page sorts the events by it.
 *
 * Sealed to the kinds lsd-mono writes, which is what the model is for: writing reports. The
 * schema's events are open (its `UnknownEvent`), so a newer schema or another producer can write a
 * kind with no class here. Code that reads a report it did not write itself, with its own parser
 * and these classes or not, must tolerate an unknown `kind`, skipping it or showing it as unknown,
 * rather than fail or assume this list is complete.
 */
@ExperimentalLsdReportModel
public sealed class EventJson {
    public abstract val id: String
    public abstract val startedAt: String?
}

/**
 * A message between two participants: an arrow. [from] and [to] are participant ids, or `""` for
 * the diagram's edge. Made with [builder]; everything after [type] is optional, and lsd-mono-core
 * sets it from what it captured and how it timed it.
 */
@ExperimentalLsdReportModel
public class MessageEventJson internal constructor(
    override val id: String,
    public val from: String,
    public val to: String,
    public val label: String,
    /** The schema's `MessageType`: one of [KnownMessageType.ALL], or another, which a reader draws as a call. */
    public val type: String,
    public val colour: String?,
    /** How long the message took, in fractional milliseconds. */
    public val durationMs: Double?,
    /**
     * The message's payload, a JSON value. Null means none, and is not written; [DataValueJson.NULL]
     * is written as `null`. [DataValueJson.from] makes one from plain values (maps, lists, strings,
     * numbers, booleans).
     */
    public val data: DataValueJson?,
    /**
     * The key into the payload file (`<scenarioId>/<messageId>`) when [data] keeps only method, path
     * and status. The writer sets it in the diagram page's copy; leave it null.
     */
    public val payloadId: String?,
    override val startedAt: String?,
    /** The capture order. Null when not counted. */
    public val seq: Long?,
    /** The call's id, which its reply names in [replyTo]. */
    public val callId: String?,
    /** On a reply: the [callId] of the call it answers. */
    public val replyTo: String?,
    /** On a consume: the publish that caused it. */
    public val causedBy: String?,
    public val trace: TraceJson?,
    /** The clock domain, such as a service name. Null means local. */
    public val source: String?,
    /** The wall-clock time of capture. Left out of reproducible reports. */
    public val capturedAt: String?,
    /** The message's status, such as an HTTP status, as text: `200`, `404 Not Found`. */
    public val status: String?,
    /** The schema's `TimingSource`: how [durationMs] was found, one of [KnownTimingSource.ALL] or another. */
    public val timing: String?,
    /** The schema's `PairingSource`: how the call and its reply were paired, one of [KnownPairingSource.ALL] or another. */
    public val pairing: String?,
    /** The schema's `OrderSource`: what put the message in its place, one of [KnownOrderSource.ALL] or another. */
    public val order: String?,
    /** The id of the call this message runs inside. */
    public val parentId: String?,
    /** On a paired reply: the id of the call it answers. */
    public val replyOf: String?,
    /**
     * Facts about the message by OpenTelemetry semantic convention name, such as `http.route`.
     * Keys are not empty; `lsd.` keys are kept for lsd-mono's own. Written when there are any.
     */
    public val attributes: Map<String, AttributeValueJson>,
    /**
     * The schema's `MessageOrigin`: one of [KnownMessageOrigin.ALL], or another. Null means
     * [KnownMessageOrigin.CAPTURED]: leave it null for a message the producer recorded itself.
     */
    public val origin: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id, from, to, label, type)
            .colour(colour)
            .durationMs(durationMs)
            .data(data)
            .payloadId(payloadId)
            .startedAt(startedAt)
            .seq(seq)
            .callId(callId)
            .replyTo(replyTo)
            .causedBy(causedBy)
            .trace(trace)
            .source(source)
            .capturedAt(capturedAt)
            .status(status)
            .timing(timing)
            .pairing(pairing)
            .order(order)
            .parentId(parentId)
            .replyOf(replyOf)
            .attributes(attributes)
            .origin(origin)

    override fun equals(other: Any?): Boolean = other is MessageEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("MessageEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "from" to from,
            "to" to to,
            "label" to label,
            "type" to type,
            "colour" to colour,
            "durationMs" to durationMs,
            "data" to data,
            "payloadId" to payloadId,
            "startedAt" to startedAt,
            "seq" to seq,
            "callId" to callId,
            "replyTo" to replyTo,
            "causedBy" to causedBy,
            "trace" to trace,
            "source" to source,
            "capturedAt" to capturedAt,
            "status" to status,
            "timing" to timing,
            "pairing" to pairing,
            "order" to order,
            "parentId" to parentId,
            "replyOf" to replyOf,
            "attributes" to attributes,
            "origin" to origin,
        )

    /** Makes a [MessageEventJson], with every optional field unset (null, or no attributes) until set. */
    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
        private val from: String,
        private val to: String,
        private val label: String,
        private val type: String,
    ) {
        private var colour: String? = null
        private var durationMs: Double? = null
        private var data: DataValueJson? = null
        private var payloadId: String? = null
        private var startedAt: String? = null
        private var seq: Long? = null
        private var callId: String? = null
        private var replyTo: String? = null
        private var causedBy: String? = null
        private var trace: TraceJson? = null
        private var source: String? = null
        private var capturedAt: String? = null
        private var status: String? = null
        private var timing: String? = null
        private var pairing: String? = null
        private var order: String? = null
        private var parentId: String? = null
        private var replyOf: String? = null
        private val attributes = linkedMapOf<String, AttributeValueJson>()
        private var origin: String? = null

        public fun colour(value: String?): Builder = apply { colour = value }

        public fun durationMs(value: Double?): Builder = apply { durationMs = value }

        /** The payload, or null for none. [DataValueJson.from] makes one from plain values. */
        public fun data(value: DataValueJson?): Builder = apply { data = value }

        public fun payloadId(value: String?): Builder = apply { payloadId = value }

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun seq(value: Long?): Builder = apply { seq = value }

        public fun callId(value: String?): Builder = apply { callId = value }

        public fun replyTo(value: String?): Builder = apply { replyTo = value }

        public fun causedBy(value: String?): Builder = apply { causedBy = value }

        public fun trace(value: TraceJson?): Builder = apply { trace = value }

        public fun source(value: String?): Builder = apply { source = value }

        public fun capturedAt(value: String?): Builder = apply { capturedAt = value }

        public fun status(value: String?): Builder = apply { status = value }

        public fun timing(value: String?): Builder = apply { timing = value }

        public fun pairing(value: String?): Builder = apply { pairing = value }

        public fun order(value: String?): Builder = apply { order = value }

        public fun parentId(value: String?): Builder = apply { parentId = value }

        public fun replyOf(value: String?): Builder = apply { replyOf = value }

        public fun origin(value: String?): Builder = apply { origin = value }

        /** Sets one attribute, replacing any with the same [key]. The key is not empty. */
        public fun attribute(
            key: String,
            value: AttributeValueJson,
        ): Builder =
            apply {
                requireAttributeKey(key)
                attributes[key] = value
            }

        public fun attribute(
            key: String,
            value: String,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        public fun attribute(
            key: String,
            value: Boolean,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        public fun attribute(
            key: String,
            value: Long,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        public fun attribute(
            key: String,
            value: Int,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        /** A finite number: JSON has no NaN or infinity. */
        public fun attribute(
            key: String,
            value: Double,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        /** Replaces the attributes. No key is empty. */
        public fun attributes(values: Map<String, AttributeValueJson>): Builder =
            apply {
                values.keys.forEach(::requireAttributeKey)
                attributes.clear()
                attributes.putAll(values)
            }

        public fun build(): MessageEventJson = MessageEventJson(
            id,
            from,
            to,
            label,
            type,
            colour,
            durationMs,
            data,
            payloadId,
            startedAt,
            seq,
            callId,
            replyTo,
            causedBy,
            trace,
            source,
            capturedAt,
            status,
            timing,
            pairing,
            order,
            parentId,
            replyOf,
            attributes.toMap(),
            origin,
        )
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(id: String, from: String, to: String, label: String, type: String): Builder = Builder(id, from, to, label, type)
    }
}

/**
 * Trace context on a message: its trace, its span and the span it runs inside. Frozen at these
 * three ids, so it stays a data class: anything more about a span (flags, state, kind, status) goes
 * in [MessageEventJson.attributes]. W3C Trace Context and OpenTelemetry ids are lowercase hex, 32
 * characters for [traceId] and 16 for the span ids; B3 ids, including a 64-bit [traceId], are
 * written as they are too.
 */
@ExperimentalLsdReportModel
public data class TraceJson
    @JvmOverloads
    constructor(
        val traceId: String,
        val spanId: String? = null,
        val parentSpanId: String? = null,
    )

/** A note, over a participant or beside the diagram. Made with [builder]. */
@ExperimentalLsdReportModel
public class NoteEventJson internal constructor(
    override val id: String,
    public val text: String,
    /** The participant the note is over. Needed for [placement] `over`; optional for `left` and `right`. */
    public val over: String?,
    /** Where the note goes. */
    public val placement: NotePlacementJson,
    override val startedAt: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id, text)
            .over(over)
            .placement(placement)
            .startedAt(startedAt)

    override fun equals(other: Any?): Boolean = other is NoteEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("NoteEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "text" to text,
            "over" to over,
            "placement" to placement,
            "startedAt" to startedAt,
        )

    /** Makes a [NoteEventJson]: over its participant ([NotePlacementJson.OVER]) unless placed otherwise. */
    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
        private val text: String,
    ) {
        private var over: String? = null
        private var placement: NotePlacementJson = NotePlacementJson.OVER
        private var startedAt: String? = null

        public fun over(value: String?): Builder = apply { over = value }

        public fun placement(value: NotePlacementJson): Builder = apply { placement = value }

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun build(): NoteEventJson = NoteEventJson(id, text, over, placement, startedAt)
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(id: String, text: String): Builder = Builder(id, text)
    }
}

/** A gap in time, drawn as a break in the lifelines. Made with [builder]. */
@ExperimentalLsdReportModel
public class DelayEventJson internal constructor(
    override val id: String,
    public val label: String?,
    override val startedAt: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id)
            .label(label)
            .startedAt(startedAt)

    override fun equals(other: Any?): Boolean = other is DelayEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("DelayEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "label" to label,
            "startedAt" to startedAt,
        )

    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
    ) {
        private var label: String? = null
        private var startedAt: String? = null

        public fun label(value: String?): Builder = apply { label = value }

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun build(): DelayEventJson = DelayEventJson(id, label, startedAt)
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(id: String): Builder = Builder(id)
    }
}

/** Empty space in the diagram. Made with [builder]. */
@ExperimentalLsdReportModel
public class SpacerEventJson internal constructor(
    override val id: String,
    /** The height in pixels; the page's default when null. */
    public val heightPx: Int?,
    override val startedAt: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id)
            .heightPx(heightPx)
            .startedAt(startedAt)

    override fun equals(other: Any?): Boolean = other is SpacerEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("SpacerEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "heightPx" to heightPx,
            "startedAt" to startedAt,
        )

    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
    ) {
        private var heightPx: Int? = null
        private var startedAt: String? = null

        public fun heightPx(value: Int?): Builder = apply { heightPx = value }

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun build(): SpacerEventJson = SpacerEventJson(id, heightPx, startedAt)
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(id: String): Builder = Builder(id)
    }
}

/** A labelled line across the diagram. Made with [builder]. */
@ExperimentalLsdReportModel
public class DividerEventJson internal constructor(
    override val id: String,
    public val label: String,
    override val startedAt: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id, label)
            .startedAt(startedAt)

    override fun equals(other: Any?): Boolean = other is DividerEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("DividerEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "label" to label,
            "startedAt" to startedAt,
        )

    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
        private val label: String,
    ) {
        private var startedAt: String? = null

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun build(): DividerEventJson = DividerEventJson(id, label, startedAt)
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(id: String, label: String): Builder = Builder(id, label)
    }
}

/** The start of a titled section of the scenario. Made with [builder]. */
@ExperimentalLsdReportModel
public class SectionEventJson internal constructor(
    override val id: String,
    public val title: String,
    override val startedAt: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id, title)
            .startedAt(startedAt)

    override fun equals(other: Any?): Boolean = other is SectionEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("SectionEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "title" to title,
            "startedAt" to startedAt,
        )

    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
        private val title: String,
    ) {
        private var startedAt: String? = null

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun build(): SectionEventJson = SectionEventJson(id, title, startedAt)
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(id: String, title: String): Builder = Builder(id, title)
    }
}

/** A lifeline starting or stopping its activation bar. Made with [builder]. */
@ExperimentalLsdReportModel
public class LifelineEventJson internal constructor(
    /** Whether the bar starts or stops. */
    public val kind: LifelineKindJson,
    override val id: String,
    /** The participant whose lifeline it is. */
    public val participantId: String,
    /** The bar's CSS colour. Only on [LifelineKindJson.ACTIVATE]. */
    public val colour: String?,
    override val startedAt: String?,
) : EventJson() {
    /** A builder holding this event's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(kind, id, participantId)
            .colour(colour)
            .startedAt(startedAt)

    override fun equals(other: Any?): Boolean = other is LifelineEventJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("LifelineEventJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "kind" to kind,
            "id" to id,
            "participantId" to participantId,
            "colour" to colour,
            "startedAt" to startedAt,
        )

    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val kind: LifelineKindJson,
        private val id: String,
        private val participantId: String,
    ) {
        private var colour: String? = null
        private var startedAt: String? = null

        public fun colour(value: String?): Builder = apply { colour = value }

        public fun startedAt(value: String?): Builder = apply { startedAt = value }

        public fun build(): LifelineEventJson = LifelineEventJson(kind, id, participantId, colour, startedAt)
    }

    public companion object {
        /** A builder for an event with what the schema requires of one. */
        @JvmStatic
        public fun builder(kind: LifelineKindJson, id: String, participantId: String): Builder = Builder(kind, id, participantId)
    }
}
