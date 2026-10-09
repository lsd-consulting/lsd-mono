package io.lsdconsulting.lsd.mono.core.capture

import io.lsdconsulting.lsd.mono.core.IdGenerator
import io.lsdconsulting.lsd.mono.core.domain.Delay
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.NotePlacement
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Spacer
import java.time.Instant

/**
 * Builds a [SequenceEvent] using the context's [IdGenerator] so deterministic ids stay consistent.
 * Mirrors legacy `SequenceEventBuilder` (passed to `LsdContext.capture`).
 */
fun interface SequenceEventBuilder {
    fun build(ids: IdGenerator): SequenceEvent
}

class MessageBuilder : SequenceEventBuilder {
    private var id: String? = null
    private var from: String = ""
    private var to: String = ""
    private var label: String = ""
    private var data: Any? = null
    private var colour: String? = null
    private var durationMs: Long? = null
    private var type: MessageType = MessageType.SYNCHRONOUS

    fun id(id: String) = apply { this.id = id }

    fun from(from: String) = apply { this.from = from }

    fun from(from: Participant) = apply { this.from = from.id }

    fun to(to: String) = apply { this.to = to }

    fun to(to: Participant) = apply { this.to = to.id }

    fun label(label: String) = apply { this.label = label }

    fun data(data: Any?) = apply { this.data = data }

    fun colour(colour: String?) = apply { this.colour = colour }

    fun type(type: MessageType) = apply { this.type = type }

    fun durationMs(durationMs: Long?) = apply { this.durationMs = durationMs }

    override fun build(ids: IdGenerator): Message =
        Message(
            id = id ?: ids.next(),
            from = from,
            to = to,
            label = label,
            type = type,
            colour = colour,
            data = data,
            durationMs = durationMs,
        )

    companion object {
        @JvmStatic
        fun messageBuilder(): MessageBuilder = MessageBuilder()
    }
}

infix fun String.messages(other: String): MessageBuilder = MessageBuilder().from(this).to(other)

infix fun String.messages(other: Participant): MessageBuilder = MessageBuilder().from(this).to(other)

infix fun Participant.messages(other: String): MessageBuilder = MessageBuilder().from(this).to(other)

infix fun Participant.messages(other: Participant): MessageBuilder = MessageBuilder().from(this).to(other)

infix fun MessageBuilder.withLabel(label: String): MessageBuilder = label(label)

infix fun MessageBuilder.withData(data: Any?): MessageBuilder = data(data)

infix fun MessageBuilder.withType(type: MessageType): MessageBuilder = type(type)

infix fun MessageBuilder.withColour(colour: String): MessageBuilder = colour(colour)

infix fun MessageBuilder.withDurationMs(durationMs: Long): MessageBuilder = durationMs(durationMs)

/**
 * Legacy-shaped lifeline: `capture(LifelineAction.ACTIVATE lifeline "api")`.
 * Optional colour (`withColour`) applies to activate only and is written on the JSON event.
 */
class LifelineBuilder(
    private val action: LifelineAction,
    private val participant: String,
) : SequenceEventBuilder {
    private var colour: String? = null
    private var createdAt: Instant? = null

    fun colour(colour: String?) = apply { this.colour = colour }

    fun createdAt(at: Instant?) = apply { this.createdAt = at }

    override fun build(ids: IdGenerator): Lifeline =
        Lifeline(
            id = ids.next(),
            participantId = participant,
            action = action,
            colour = colour?.takeIf { action == LifelineAction.ACTIVATE && it.isNotBlank() },
            createdAt = createdAt,
        )
}

infix fun LifelineAction.lifeline(participant: String): LifelineBuilder = LifelineBuilder(this, participant)

infix fun LifelineAction.lifeline(participant: Participant): LifelineBuilder = lifeline(participant.id)

/** Sets the activation-bar colour. No effect on deactivate. */
infix fun LifelineBuilder.withColour(colour: String): LifelineBuilder = colour(colour)

fun noteOver(participant: String, text: String): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Note(id = ids.next(), text = text, over = participant, placement = NotePlacement.OVER)
    }

fun noteOver(participant: Participant, text: String): SequenceEventBuilder = noteOver(participant.id, text)

/** Note left of an optional anchor participant (migration-friendly vs legacy NoteLeft). */
fun noteLeft(text: String, of: String? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Note(id = ids.next(), text = text, over = of, placement = NotePlacement.LEFT)
    }

fun noteLeft(text: String, of: Participant): SequenceEventBuilder = noteLeft(text, of.id)

/** Note right of an optional anchor participant (migration-friendly vs legacy NoteRight). */
fun noteRight(text: String, of: String? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Note(id = ids.next(), text = text, over = of, placement = NotePlacement.RIGHT)
    }

fun noteRight(text: String, of: Participant): SequenceEventBuilder = noteRight(text, of.id)

/** Legacy name for a diagram section break (`== label ==` in PlantUML). */
fun logicalDivider(label: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Divider(id = ids.next(), label = label) }

/**
 * Continuous-diagram section (replaces legacy `newpage`).
 * `capture(section("Phase 2"))` — activations stay open across the boundary.
 */
fun section(title: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Section(id = ids.next(), title = title) }

/** Time delay (`...` / `...label...`). */
fun delay(label: String? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Delay(id = ids.next(), label = label) }

/** Vertical spacer (`|||` / sized). */
fun spacer(heightPx: Int? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Spacer(id = ids.next(), heightPx = heightPx) }

/** Short inbound arrow from diagram edge to [to] (no fake participant). */
fun shortInbound(to: String, label: String = ""): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Message(
            id = ids.next(),
            from = "",
            to = to,
            label = label,
            type = MessageType.SHORT_INBOUND,
        )
    }

fun shortInbound(to: Participant, label: String = ""): SequenceEventBuilder = shortInbound(to.id, label)

/** Short outbound arrow from [from] toward diagram edge (no fake participant). */
fun shortOutbound(from: String, label: String = ""): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Message(
            id = ids.next(),
            from = from,
            to = "",
            label = label,
            type = MessageType.SHORT_OUTBOUND,
        )
    }

fun shortOutbound(from: Participant, label: String = ""): SequenceEventBuilder = shortOutbound(from.id, label)
