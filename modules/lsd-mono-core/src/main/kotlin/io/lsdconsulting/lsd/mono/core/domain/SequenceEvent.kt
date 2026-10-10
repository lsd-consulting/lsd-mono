package io.lsdconsulting.lsd.mono.core.domain

import java.time.Instant

/**
 * In-memory sequence events. JSON `kind` values match report `DiagramEvent`.
 *
 * A [Section] is the greenfield replacement for PlantUML `newpage`: a titled row
 * in one continuous diagram. Activations are not closed at section boundaries.
 *
 * Notes use [NotePlacement] (`over` / `left` / `right`) instead of separate
 * NoteLeft / NoteRight types. [Delay] and [Spacer] replace PlantUML `...` / `|||`.
 * [MessageType.SHORT_INBOUND] / [MessageType.SHORT_OUTBOUND] draw from/to a
 * phantom diagram edge — not a fake participant.
 *
 * Optional [createdAt] is an ISO instant used to reorder out-of-order capture
 * before the report is written. Events without it keep capture order and sort
 * after any timed events.
 *
 * Deferred vs legacy: PageTitle as its own event.
 */
public sealed class SequenceEvent {
    public abstract val id: String
    public abstract val createdAt: Instant?
}

public enum class MessageType {
    SYNCHRONOUS,
    SYNCHRONOUS_RESPONSE,
    ASYNCHRONOUS,
    LOST,
    BI_DIRECTIONAL,
    SHORT_INBOUND,
    SHORT_OUTBOUND,
}

public enum class NotePlacement {
    OVER,
    LEFT,
    RIGHT,
}

public data class Message @JvmOverloads constructor(
    override val id: String,
    val from: String,
    val to: String,
    val label: String = "",
    val type: MessageType = MessageType.SYNCHRONOUS,
    val colour: String? = null,
    val data: Any? = null,
    val durationMs: Long? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/**
 * Note card. [placement] defaults to [NotePlacement.OVER] (requires [over]).
 * Left/right may omit [over] (diagram-edge note) or set it as the anchor lifeline.
 */
public data class Note @JvmOverloads constructor(
    override val id: String,
    val text: String,
    val over: String? = null,
    val placement: NotePlacement = NotePlacement.OVER,
    override val createdAt: Instant? = null,
) : SequenceEvent()

public data class Divider(
    override val id: String,
    val label: String,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/** Titled break in a continuous diagram. Does not split the SVG or drop activations. */
public data class Section(
    override val id: String,
    val title: String,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/** Time-delay ellipsis row (`...label...` in PlantUML). */
public data class Delay @JvmOverloads constructor(
    override val id: String,
    val label: String? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()

/** Vertical spacer (`|||` / sized `||N||` in PlantUML). [heightPx] defaults in the UI. */
public data class Spacer @JvmOverloads constructor(
    override val id: String,
    val heightPx: Int? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()

public enum class LifelineAction { ACTIVATE, DEACTIVATE }

public data class Lifeline @JvmOverloads constructor(
    override val id: String,
    val participantId: String,
    val action: LifelineAction = LifelineAction.ACTIVATE,
    /** Optional emphasis on an activation bar. Ignored for deactivate. Absent means the default bar. */
    val colour: String? = null,
    override val createdAt: Instant? = null,
) : SequenceEvent()
