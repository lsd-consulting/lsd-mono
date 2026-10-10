package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.capture.SequenceEventBuilder
import io.lsdconsulting.lsd.mono.core.domain.Delay
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.LifelineAction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.NoteSide
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Spacer
import java.time.Instant

/**
 * The capture verbs. [LsdContext] captures into the current scenario (see its notes on
 * threads); [LsdScenario] captures into itself. Each call records one event straight away.
 *
 * Participants are named by their name, id or display name. A name that was never passed
 * to [LsdContext.addParticipants] becomes a plain participant.
 *
 * Every verb takes an optional [Instant] `at`: when it happened. The report orders timed
 * events by it, for capture that arrives out of order (interceptors on other threads);
 * untimed events keep their capture order and come after the timed ones.
 *
 * Only lsd-mono's own classes extend this.
 */
public sealed class Capturer {
    /** A message from [from] to [to]. The default [type] is a synchronous call. */
    @JvmOverloads
    public fun message(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        type: MessageType = MessageType.SYNCHRONOUS,
        durationMs: Long? = null,
        colour: String? = null,
        at: Instant? = null,
    ) {
        emit(
            Message(
                id = "",
                from = from,
                to = to,
                label = label,
                type = type,
                colour = colour,
                data = data,
                durationMs = durationMs,
                createdAt = at,
            ),
        )
    }

    /** The response to a synchronous call: [from] is the callee. */
    @JvmOverloads
    public fun response(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        durationMs: Long? = null,
        at: Instant? = null,
    ) {
        message(from, to, label, data, MessageType.SYNCHRONOUS_RESPONSE, durationMs, at = at)
    }

    /** An asynchronous message, such as an event published to a queue. */
    @JvmOverloads
    public fun async(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        at: Instant? = null,
    ) {
        message(from, to, label, data, MessageType.ASYNCHRONOUS, at = at)
    }

    /** A short arrow into [to] from the edge of the diagram, for a caller that is not drawn. */
    @JvmOverloads
    public fun inbound(to: String, label: String = "", at: Instant? = null) {
        emit(Message(id = "", from = null, to = to, label = label, type = MessageType.SHORT_INBOUND, createdAt = at))
    }

    /** A short arrow from [from] to the edge of the diagram, for a callee that is not drawn. */
    @JvmOverloads
    public fun outbound(from: String, label: String = "", at: Instant? = null) {
        emit(Message(id = "", from = from, to = null, label = label, type = MessageType.SHORT_OUTBOUND, createdAt = at))
    }

    /**
     * A note. [NoteSide.OVER] (the default) puts it over participant [on], which it needs.
     * [NoteSide.LEFT] and [NoteSide.RIGHT] put it beside [on], or at the edge of the diagram
     * when [on] is null.
     */
    @JvmOverloads
    public fun note(
        text: String,
        on: String? = null,
        side: NoteSide = NoteSide.OVER,
        at: Instant? = null,
    ) {
        require(side != NoteSide.OVER || !on.isNullOrBlank()) { "A note over a participant needs the participant: pass on" }
        emit(Note(id = "", text = text, over = on, placement = side, createdAt = at))
    }

    /** Start an activation bar on [participant], optionally in [colour] (for example `#c026d3`). */
    @JvmOverloads
    public fun activate(participant: String, colour: String? = null, at: Instant? = null) {
        emit(
            Lifeline(
                id = "",
                participantId = participant,
                action = LifelineAction.ACTIVATE,
                colour = colour?.takeIf { it.isNotBlank() },
                createdAt = at,
            ),
        )
    }

    /** End the innermost activation bar on [participant]. */
    @JvmOverloads
    public fun deactivate(participant: String, at: Instant? = null) {
        emit(Lifeline(id = "", participantId = participant, action = LifelineAction.DEACTIVATE, createdAt = at))
    }

    /** A titled section. The diagram continues and activations stay open across it. */
    @JvmOverloads
    public fun section(title: String, at: Instant? = null) {
        emit(Section(id = "", title = title, createdAt = at))
    }

    /** A labelled divider line across the diagram. */
    @JvmOverloads
    public fun divider(label: String, at: Instant? = null) {
        emit(Divider(id = "", label = label, createdAt = at))
    }

    /** A gap that stands for time passing, optionally labelled. */
    @JvmOverloads
    public fun delay(label: String? = null, at: Instant? = null) {
        emit(Delay(id = "", label = label, createdAt = at))
    }

    /** Extra vertical space, [heightPx] high or the report's default. */
    @JvmOverloads
    public fun spacer(heightPx: Int? = null, at: Instant? = null) {
        emit(Spacer(id = "", heightPx = heightPx, createdAt = at))
    }

    /** A key/value fact shown with the scenario. */
    @JvmOverloads
    public fun addFact(key: String, value: String = "") {
        fact(key, value)
    }

    /** Capture events built elsewhere. Tests only; callers use the verbs. */
    internal fun capture(vararg events: SequenceEvent) {
        emit(events.toList())
    }

    /** Capture events from builders (`"A" messages "B" withLabel "..."`). */
    public fun capture(vararg builders: SequenceEventBuilder) {
        emit(builders.map { it.build() })
    }

    private fun emit(event: SequenceEvent) = emit(listOf(event))

    /** Record [events] in order. Ids are assigned here, from the context's generator. */
    internal abstract fun emit(events: List<SequenceEvent>)

    internal abstract fun fact(key: String, value: String)
}
