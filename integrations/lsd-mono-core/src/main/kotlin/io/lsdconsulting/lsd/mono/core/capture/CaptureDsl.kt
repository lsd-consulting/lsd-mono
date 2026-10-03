package io.lsdconsulting.lsd.mono.core.capture

import io.lsdconsulting.lsd.mono.core.IdGenerator
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent

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

/** Legacy-shaped lifeline: `capture(LifelineAction.ACTIVATE lifeline "api")`. */
infix fun LifelineAction.lifeline(participant: String): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Lifeline(id = ids.next(), participantId = participant, action = this)
    }

infix fun LifelineAction.lifeline(participant: Participant): SequenceEventBuilder = lifeline(participant.id)

fun noteOver(participant: String, text: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Note(id = ids.next(), text = text, over = participant) }

fun noteOver(participant: Participant, text: String): SequenceEventBuilder = noteOver(participant.id, text)

/** Legacy name for a diagram section break (`== label ==` in PlantUML). */
fun logicalDivider(label: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Divider(id = ids.next(), label = label) }

/**
 * Continuous-diagram section (replaces legacy `newpage`).
 * `capture(section("Phase 2"))` — activations stay open across the boundary.
 */
fun section(title: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Section(id = ids.next(), title = title) }
