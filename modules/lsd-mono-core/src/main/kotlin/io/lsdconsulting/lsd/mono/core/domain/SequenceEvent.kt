package io.lsdconsulting.lsd.mono.core.domain

import java.time.Instant

/**
 * In-memory sequence events. JSON `kind` values match report `DiagramEvent`.
 *
 * A [Section] is the greenfield replacement for PlantUML `newpage`: a titled row
 * in one continuous diagram. Activations are not closed at section boundaries.
 *
 * Notes use [NoteSide] (`over` / `left` / `right`) instead of separate
 * NoteLeft / NoteRight types. [Delay] and [Spacer] replace PlantUML `...` / `|||`.
 * [MessageType.SHORT_INBOUND] / [MessageType.SHORT_OUTBOUND] draw from/to a
 * phantom diagram edge — not a fake participant. That end is null here and `""` in the JSON.
 *
 * Internal: callers capture through the [io.lsdconsulting.lsd.mono.core.Capturer] verbs, and
 * the context gives every event its id when it is captured.
 *
 * Optional [createdAt] is an ISO instant used to reorder out-of-order capture
 * before the report is written. Events without it keep capture order and sort
 * after any timed events.
 *
 * Deferred vs legacy: PageTitle as its own event.
 */
internal sealed class SequenceEvent {
    abstract val id: String
    abstract val createdAt: Instant?
}

/**
 * How a message's arrow is drawn. Most code never names a type, because each verb on
 * [io.lsdconsulting.lsd.mono.core.Capturer] sets one: `message` and `call` draw [SYNCHRONOUS], `response` and
 * `PendingCall.reply` draw [SYNCHRONOUS_RESPONSE], `async` draws [ASYNCHRONOUS], `inbound` draws
 * [SHORT_INBOUND] and `outbound` draws [SHORT_OUTBOUND]. Pass a type to `message` only for the
 * two that have no verb, [LOST] and [BI_DIRECTIONAL]: `message("A", "B", "dropped", MessageType.LOST)`.
 */
public enum class MessageType {
    /** A call, solid with a filled head. The verbs `message` and `call`. */
    SYNCHRONOUS,

    /** The reply to a call, dashed with a filled head. The verbs `response` and `PendingCall.reply`. */
    SYNCHRONOUS_RESPONSE,

    /** A fire-and-forget message, dashed with an open head. The verb `async`. */
    ASYNCHRONOUS,

    /** A message that never arrives, ending in a cross. No verb: `message(from, to, label, MessageType.LOST)`. */
    LOST,

    /** An exchange in both directions, with a head at each end. No verb. */
    BI_DIRECTIONAL,

    /**
     * A short arrow into a participant from off the diagram. The verb `inbound(to)`; through
     * `message`, only `to` is kept.
     */
    SHORT_INBOUND,

    /**
     * A short arrow out of a participant to off the diagram. The verb `outbound(from)`; through
     * `message`, only `from` is kept.
     */
    SHORT_OUTBOUND,
}

/** Where a note goes, relative to its participant. See [io.lsdconsulting.lsd.mono.core.Capturer.note]. */
public enum class NoteSide {
    /** Over the participant, which is required. */
    OVER,

    /** Left of the participant, or at the diagram's left edge when there is none. */
    LEFT,

    /** Right of the participant, or at the diagram's right edge when there is none. */
    RIGHT,
}

internal data class Message(
    override val id: String,
    /** Null for a [MessageType.SHORT_INBOUND] arrow, which starts at the diagram's edge. */
    val from: String?,
    /** Null for a [MessageType.SHORT_OUTBOUND] arrow, which ends at the diagram's edge. */
    val to: String?,
    val label: String = "",
    val type: MessageType = MessageType.SYNCHRONOUS,
    val colour: String? = null,
    val data: Any? = null,
    val durationMs: Long? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/**
 * Note card. [placement] defaults to [NoteSide.OVER] (requires [over]).
 * Left/right may omit [over] (diagram-edge note) or set it as the anchor lifeline.
 */
internal data class Note(
    override val id: String,
    val text: String,
    val over: String? = null,
    val placement: NoteSide = NoteSide.OVER,
    override val createdAt: Instant? = null,
) : SequenceEvent()

internal data class Divider(
    override val id: String,
    val label: String,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/** Titled break in a continuous diagram. Does not split the SVG or drop activations. */
internal data class Section(
    override val id: String,
    val title: String,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/** Time-delay ellipsis row (`...label...` in PlantUML). */
internal data class Delay(
    override val id: String,
    val label: String? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/** Vertical spacer (`|||` / sized `||N||` in PlantUML). [heightPx] defaults in the UI. */
internal data class Spacer(
    override val id: String,
    val heightPx: Int? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()

internal enum class LifelineAction { ACTIVATE, DEACTIVATE }

internal data class Lifeline(
    override val id: String,
    val participantId: String,
    val action: LifelineAction = LifelineAction.ACTIVATE,
    /** Optional emphasis on an activation bar. Ignored for deactivate. Absent means the default bar. */
    val colour: String? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()
