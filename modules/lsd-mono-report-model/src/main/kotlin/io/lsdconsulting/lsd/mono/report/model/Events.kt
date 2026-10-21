package io.lsdconsulting.lsd.mono.report.model

/**
 * Something that happened in a scenario, drawn as one row of the diagram. Each kind is a
 * subclass; every event has an [id], unique within its scenario, and may have a [startedAt]
 * time by its source's clock (an RFC 3339 date-time with `Z` or an offset). When any event of a
 * scenario has one, the page sorts the events by it.
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
 * the diagram's edge. The fields after [type] are optional, and lsd-mono-core sets them from what
 * it captured and how it timed it.
 */
@ExperimentalLsdReportModel
public data class MessageEventJson(
    override val id: String,
    val from: String,
    val to: String,
    val label: String,
    /** The schema's `MessageType`: one of [KnownMessageType.ALL], or another, which a reader draws as a call. */
    val type: String,
    val colour: String? = null,
    /** How long the message took, in fractional milliseconds. */
    val durationMs: Double? = null,
    /**
     * The message's payload. It should be JSON values: null, a String, a Boolean, a Number, a `Map`
     * with String keys or a `List` of these. The type is `Any?` and nothing checks it: the writer
     * writes an array as a list and anything else as its `toString()`. A JSON value type may replace
     * it before the model leaves experimental (#118).
     */
    val data: Any? = null,
    /**
     * The key into the payload file (`<scenarioId>/<messageId>`) when [data] keeps only method, path
     * and status. The writer sets it in the diagram page's copy; leave it null.
     */
    val payloadId: String? = null,
    override val startedAt: String? = null,
    /** The capture order. Null when not counted. */
    val seq: Long? = null,
    /** The call's id, which its reply names in [replyTo]. */
    val callId: String? = null,
    /** On a reply: the [callId] of the call it answers. */
    val replyTo: String? = null,
    /** On a consume: the publish that caused it. */
    val causedBy: String? = null,
    val trace: TraceJson? = null,
    /** The clock domain, such as a service name. Null means local. */
    val source: String? = null,
    /** The wall-clock time of capture. Left out of reproducible reports. */
    val capturedAt: String? = null,
    /** The message's status, such as an HTTP status, as text: `200`, `404 Not Found`. */
    val status: String? = null,
    /** The schema's `TimingSource`: how [durationMs] was found, one of [KnownTimingSource.ALL] or another. */
    val timing: String? = null,
    /** The schema's `PairingSource`: how the call and its reply were paired, one of [KnownPairingSource.ALL] or another. */
    val pairing: String? = null,
    /** The schema's `OrderSource`: what put the message in its place, one of [KnownOrderSource.ALL] or another. */
    val order: String? = null,
    /** The id of the call this message runs inside. */
    val parentId: String? = null,
    /** On a paired reply: the id of the call it answers. */
    val replyOf: String? = null,
) : EventJson()

/** Trace ids on a message. */
@ExperimentalLsdReportModel
public data class TraceJson(
    val traceId: String,
    val spanId: String?,
    val parentSpanId: String?,
)

/** A note, over a participant or beside the diagram. */
@ExperimentalLsdReportModel
public data class NoteEventJson(
    override val id: String,
    val text: String,
    /** The participant the note is over. Needed for [placement] `over`; optional for `left` and `right`. */
    val over: String? = null,
    /** Where the note goes. */
    val placement: NotePlacementJson = NotePlacementJson.OVER,
    override val startedAt: String? = null,
) : EventJson()

/** A gap in time, drawn as a break in the lifelines. */
@ExperimentalLsdReportModel
public data class DelayEventJson(
    override val id: String,
    val label: String? = null,
    override val startedAt: String? = null,
) : EventJson()

/** Empty space in the diagram. */
@ExperimentalLsdReportModel
public data class SpacerEventJson(
    override val id: String,
    /** The height in pixels; the page's default when null. */
    val heightPx: Int? = null,
    override val startedAt: String? = null,
) : EventJson()

/** A labelled line across the diagram. */
@ExperimentalLsdReportModel
public data class DividerEventJson(
    override val id: String,
    val label: String,
    override val startedAt: String? = null,
) : EventJson()

/** The start of a titled section of the scenario. */
@ExperimentalLsdReportModel
public data class SectionEventJson(
    override val id: String,
    val title: String,
    override val startedAt: String? = null,
) : EventJson()

/** A lifeline starting or stopping its activation bar. */
@ExperimentalLsdReportModel
public data class LifelineEventJson(
    /** Whether the bar starts or stops. */
    val kind: LifelineKindJson,
    override val id: String,
    /** The participant whose lifeline it is. */
    val participantId: String,
    /** The bar's CSS colour. Only on [LifelineKindJson.ACTIVATE]. */
    val colour: String? = null,
    override val startedAt: String? = null,
) : EventJson()
