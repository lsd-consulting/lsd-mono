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
public abstract class SequenceEventBuilder internal constructor() {
    internal abstract fun build(ids: IdGenerator): SequenceEvent
}

/** A builder from a function of the context's [IdGenerator]. */
internal fun SequenceEventBuilder(build: (IdGenerator) -> SequenceEvent): SequenceEventBuilder =
    object : SequenceEventBuilder() {
        override fun build(ids: IdGenerator): SequenceEvent = build(ids)
    }

public class MessageBuilder : SequenceEventBuilder() {
    private var id: String? = null
    private var from: String = ""
    private var to: String = ""
    private var label: String = ""
    private var data: Any? = null
    private var colour: String? = null
    private var durationMs: Long? = null
    private var type: MessageType = MessageType.SYNCHRONOUS

    public fun id(id: String): MessageBuilder = apply { this.id = id }

    public fun from(from: String): MessageBuilder = apply { this.from = from }

    public fun from(from: Participant): MessageBuilder = apply { this.from = from.id }

    public fun to(to: String): MessageBuilder = apply { this.to = to }

    public fun to(to: Participant): MessageBuilder = apply { this.to = to.id }

    public fun label(label: String): MessageBuilder = apply { this.label = label }

    public fun data(data: Any?): MessageBuilder = apply { this.data = data }

    public fun colour(colour: String?): MessageBuilder = apply { this.colour = colour }

    public fun type(type: MessageType): MessageBuilder = apply { this.type = type }

    public fun durationMs(durationMs: Long?): MessageBuilder = apply { this.durationMs = durationMs }

    override fun build(ids: IdGenerator): SequenceEvent =
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
}

public infix fun String.messages(other: String): MessageBuilder = MessageBuilder().from(this).to(other)

public infix fun String.messages(other: Participant): MessageBuilder = MessageBuilder().from(this).to(other)

public infix fun Participant.messages(other: String): MessageBuilder = MessageBuilder().from(this).to(other)

public infix fun Participant.messages(other: Participant): MessageBuilder = MessageBuilder().from(this).to(other)

public infix fun MessageBuilder.withLabel(label: String): MessageBuilder = label(label)

public infix fun MessageBuilder.withData(data: Any?): MessageBuilder = data(data)

public infix fun MessageBuilder.withType(type: MessageType): MessageBuilder = type(type)

public infix fun MessageBuilder.withColour(colour: String): MessageBuilder = colour(colour)

public infix fun MessageBuilder.withDurationMs(durationMs: Long): MessageBuilder = durationMs(durationMs)

/**
 * Legacy-shaped lifeline: `capture(LifelineAction.ACTIVATE lifeline "api")`.
 * Optional colour (`withColour`) applies to activate only and is written on the JSON event.
 */
public class LifelineBuilder(
    private val action: LifelineAction,
    private val participant: String,
) : SequenceEventBuilder() {
    private var colour: String? = null
    private var createdAt: Instant? = null

    public fun colour(colour: String?): LifelineBuilder = apply { this.colour = colour }

    public fun createdAt(at: Instant?): LifelineBuilder = apply { this.createdAt = at }

    override fun build(ids: IdGenerator): SequenceEvent =
        Lifeline(
            id = ids.next(),
            participantId = participant,
            action = action,
            colour = colour?.takeIf { action == LifelineAction.ACTIVATE && it.isNotBlank() },
            createdAt = createdAt,
        )
}

public infix fun LifelineAction.lifeline(participant: String): LifelineBuilder = LifelineBuilder(this, participant)

public infix fun LifelineAction.lifeline(participant: Participant): LifelineBuilder = lifeline(participant.id)

/** Sets the activation-bar colour. No effect on deactivate. */
public infix fun LifelineBuilder.withColour(colour: String): LifelineBuilder = colour(colour)

public fun noteOver(participant: String, text: String): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Note(id = ids.next(), text = text, over = participant, placement = NotePlacement.OVER)
    }

public fun noteOver(participant: Participant, text: String): SequenceEventBuilder = noteOver(participant.id, text)

/** Note left of an optional anchor participant (migration-friendly vs legacy NoteLeft). */
public fun noteLeft(text: String, of: String? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Note(id = ids.next(), text = text, over = of, placement = NotePlacement.LEFT)
    }

public fun noteLeft(text: String, of: Participant): SequenceEventBuilder = noteLeft(text, of.id)

/** Note right of an optional anchor participant (migration-friendly vs legacy NoteRight). */
public fun noteRight(text: String, of: String? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Note(id = ids.next(), text = text, over = of, placement = NotePlacement.RIGHT)
    }

public fun noteRight(text: String, of: Participant): SequenceEventBuilder = noteRight(text, of.id)

/** Legacy name for a diagram section break (`== label ==` in PlantUML). */
public fun logicalDivider(label: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Divider(id = ids.next(), label = label) }

/**
 * Continuous-diagram section (replaces legacy `newpage`).
 * `capture(section("Phase 2"))` — activations stay open across the boundary.
 */
public fun section(title: String): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Section(id = ids.next(), title = title) }

/** Time delay (`...` / `...label...`). */
public fun delay(label: String? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Delay(id = ids.next(), label = label) }

/** Vertical spacer (`|||` / sized). */
public fun spacer(heightPx: Int? = null): SequenceEventBuilder =
    SequenceEventBuilder { ids -> Spacer(id = ids.next(), heightPx = heightPx) }

/** Short inbound arrow from diagram edge to [to] (no fake participant). */
public fun shortInbound(to: String, label: String = ""): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Message(
            id = ids.next(),
            from = "",
            to = to,
            label = label,
            type = MessageType.SHORT_INBOUND,
        )
    }

public fun shortInbound(to: Participant, label: String = ""): SequenceEventBuilder = shortInbound(to.id, label)

/** Short outbound arrow from [from] toward diagram edge (no fake participant). */
public fun shortOutbound(from: String, label: String = ""): SequenceEventBuilder =
    SequenceEventBuilder { ids ->
        Message(
            id = ids.next(),
            from = from,
            to = "",
            label = label,
            type = MessageType.SHORT_OUTBOUND,
        )
    }

public fun shortOutbound(from: Participant, label: String = ""): SequenceEventBuilder = shortOutbound(from.id, label)
