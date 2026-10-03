package io.lsdconsulting.lsd.mono.core.domain

/**
 * In-memory sequence events. JSON `kind` values match report-next `DiagramEvent`.
 *
 * Deferred vs legacy `com.lsd.core.domain.SequenceEvent` (no report-next equivalent,
 * or PlantUML-only): NoteLeft / NoteRight, Newpage, PageTitle, TimeDelay, VerticalSpace,
 * MessageType.SHORT_INBOUND / SHORT_OUTBOUND.
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

data class Note(
    override val id: String,
    val text: String,
    val over: String,
) : SequenceEvent()

data class Divider(
    override val id: String,
    val label: String,
) : SequenceEvent()

enum class LifelineAction { ACTIVATE, DEACTIVATE }

data class Lifeline @JvmOverloads constructor(
    override val id: String,
    val participantId: String,
    val action: LifelineAction = LifelineAction.ACTIVATE,
) : SequenceEvent()
