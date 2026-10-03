package io.lsdconsulting.lsd.mono.core.domain

/**
 * In-memory sequence events. JSON `kind` values match report-next `DiagramEvent`.
 *
 * A [Section] is the greenfield replacement for PlantUML `newpage`: a titled row
 * in one continuous diagram. Activations are not closed at section boundaries.
 *
 * Notes use [NotePlacement] (`over` / `left` / `right`) instead of separate
 * NoteLeft / NoteRight types. [Delay] and [Spacer] replace PlantUML `...` / `|||`.
 * [MessageType.SHORT_INBOUND] / [MessageType.SHORT_OUTBOUND] draw from/to a
 * phantom diagram edge — not a fake participant.
 *
 * Deferred vs legacy: PageTitle as its own event, activate colour, timestamps.
 */
sealed class SequenceEvent {
    abstract val id: String
}

enum class MessageType {
    SYNCHRONOUS,
    SYNCHRONOUS_RESPONSE,
    ASYNCHRONOUS,
    LOST,
    BI_DIRECTIONAL,
    SHORT_INBOUND,
    SHORT_OUTBOUND,
}

enum class NotePlacement {
    OVER,
    LEFT,
    RIGHT,
}

data class Message @JvmOverloads constructor(
    override val id: String,
    val from: String,
    val to: String,
    val label: String = "",
    val type: MessageType = MessageType.SYNCHRONOUS,
    val colour: String? = null,
    val data: Any? = null,
    val durationMs: Long? = null,
) : SequenceEvent()

/**
 * Note card. [placement] defaults to [NotePlacement.OVER] (requires [over]).
 * Left/right may omit [over] (diagram-edge note) or set it as the anchor lifeline.
 */
data class Note @JvmOverloads constructor(
    override val id: String,
    val text: String,
    val over: String? = null,
    val placement: NotePlacement = NotePlacement.OVER,
) : SequenceEvent()

data class Divider(
    override val id: String,
    val label: String,
) : SequenceEvent()

/** Titled break in a continuous diagram. Does not split the SVG or drop activations. */
data class Section(
    override val id: String,
    val title: String,
) : SequenceEvent()

/** Time-delay ellipsis row (`...label...` in PlantUML). */
data class Delay @JvmOverloads constructor(
    override val id: String,
    val label: String? = null,
) : SequenceEvent()

/** Vertical spacer (`|||` / sized `||N||` in PlantUML). [heightPx] defaults in the UI. */
data class Spacer @JvmOverloads constructor(
    override val id: String,
    val heightPx: Int? = null,
) : SequenceEvent()

enum class LifelineAction { ACTIVATE, DEACTIVATE }

data class Lifeline @JvmOverloads constructor(
    override val id: String,
    val participantId: String,
    val action: LifelineAction = LifelineAction.ACTIVATE,
) : SequenceEvent()
