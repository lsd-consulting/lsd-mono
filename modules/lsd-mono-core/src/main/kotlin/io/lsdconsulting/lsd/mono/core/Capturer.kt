package io.lsdconsulting.lsd.mono.core

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
 * The message verbs take a [Timing], the one place for message timing: `startedAt` (when it
 * happened), a measured fractional `durationMs`, the clock source and an ordering hint, plus a
 * [Trace] (trace and span ids). [ingest] takes [Interaction]s from other libraries. Structural
 * rows (notes, activations, sections, dividers, delays, spacers) take an optional [Instant] `at`.
 * By default (`lsd.mono.timing.orderByStartedAt=source`) events from one source that have a start
 * and no measured duration are ordered by it, for capture that arrives out of order (interceptors
 * on other threads); untimed events keep their capture position. A reply never moves before its
 * call, nor a child out of its parent.
 *
 * Capturing never throws into the application because of something going wrong inside
 * LSD, so an interceptor can call these verbs on a request path: a failure is logged
 * (`System.Logger`, a WARNING the first time for each kind) and the event dropped. Misusing
 * the API still throws, because that is a mistake in the test: a [NoteSide.OVER] note with
 * no participant, a [CaptureBlock] used after its block, and from Java a `null` for a
 * parameter that is not nullable.
 *
 * Only lsd-mono's own classes extend this.
 */
@LsdDsl
public sealed class Capturer {
    /**
     * A message from [from] to [to]. [type] defaults to [MessageType.SYNCHRONOUS], and so
     * does a `null` type (so Java can pass `null`).
     */
    @JvmOverloads
    public fun message(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        type: MessageType? = MessageType.SYNCHRONOUS,
        colour: String? = null,
        timing: Timing? = null,
        trace: Trace? = null,
    ) {
        emit(
            Message(
                id = "",
                from = from,
                to = to,
                label = label,
                type = type ?: MessageType.SYNCHRONOUS,
                colour = colour,
                data = data,
            ).withTiming(timing, trace),
        )
    }

    /**
     * A message of [type] with no data. With this overload, `message(from, to, label, MessageType.LOST)`
     * means the type, from Kotlin and Java. Without it the type would be taken as `data`, because
     * `data` comes before `type` in the full form. A `null` [type] is a synchronous call with
     * no data, so Java's `message(from, to, label, null)` (which picks this overload) works.
     */
    public fun message(
        from: String,
        to: String,
        label: String,
        type: MessageType?,
    ) {
        message(from, to, label, null, type)
    }

    /**
     * A synchronous call from [from] to [to], captured now. Finish it with
     * [PendingCall.reply] or [PendingCall.fail], from any thread: the response is drawn
     * back from [to], timed, in the same scenario. The time between this and the reply counts
     * as a measured duration unless [timing] gives one. [PendingCall.callId] is the call's id.
     */
    @JvmOverloads
    public fun call(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        timing: Timing? = null,
        trace: Trace? = null,
    ): PendingCall =
        startCall(
            Message(
                id = "",
                from = from,
                to = to,
                label = label,
                type = MessageType.SYNCHRONOUS,
                data = data,
                callRef = CallRef(null),
            ).withTiming(timing, trace),
        )

    /**
     * The response to a synchronous call: [from] is the callee. [replyTo] pairs it with its call
     * exactly; without it (or a span id in [trace]) the pairing is guessed from the direction.
     * A duration here belongs to the call.
     */
    @JvmOverloads
    public fun response(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        timing: Timing? = null,
        trace: Trace? = null,
        replyTo: CallRef? = null,
    ) {
        emit(
            Message(
                id = "",
                from = from,
                to = to,
                label = label,
                type = MessageType.SYNCHRONOUS_RESPONSE,
                data = data,
                replyTo = replyTo,
            ).withTiming(timing, trace),
        )
    }

    /**
     * An asynchronous message, such as an event published to a queue. Returns its id: pass it
     * as [causedBy] when capturing the consume, so the consume is never drawn before it.
     */
    @JvmOverloads
    public fun async(
        from: String,
        to: String,
        label: String = "",
        data: Any? = null,
        timing: Timing? = null,
        trace: Trace? = null,
        causedBy: CallRef? = null,
    ): CallRef {
        val ref = CallRef(null)
        emit(
            Message(
                id = "",
                from = from,
                to = to,
                label = label,
                type = MessageType.ASYNCHRONOUS,
                data = data,
                callRef = ref,
                causedBy = causedBy,
            ).withTiming(timing, trace),
        )
        return ref
    }

    /**
     * Capture an [Interaction] from another library (an interceptor, a listener, an importer).
     * Whatever it leaves out degrades gracefully: no ids means guessed pairing, no duration means
     * no measured timing. A zero duration is treated as absent.
     */
    public fun ingest(interaction: Interaction) {
        emit(interaction.toMessage())
    }

    /** A short arrow into [to] from the edge of the diagram, for a caller that is not drawn. */
    @JvmOverloads
    public fun inbound(to: String, label: String = "", timing: Timing? = null) {
        emit(Message(id = "", from = null, to = to, label = label, type = MessageType.SHORT_INBOUND).withTiming(timing, null))
    }

    /** A short arrow from [from] to the edge of the diagram, for a callee that is not drawn. */
    @JvmOverloads
    public fun outbound(from: String, label: String = "", timing: Timing? = null) {
        emit(Message(id = "", from = from, to = null, label = label, type = MessageType.SHORT_OUTBOUND).withTiming(timing, null))
    }

    /**
     * A note. [NoteSide.OVER] (the default) puts it over participant [on], which it needs.
     * [NoteSide.LEFT] and [NoteSide.RIGHT] put it beside [on], or at the edge of the diagram
     * when [on] is null: `note("retries", on = null, side = NoteSide.RIGHT)`.
     * [on] has no default, so a note cannot silently lack its participant.
     *
     * @throws IllegalArgumentException for an [NoteSide.OVER] note with no [on].
     */
    @JvmOverloads
    public fun note(
        text: String,
        on: String?,
        side: NoteSide = NoteSide.OVER,
        at: Instant? = null,
    ) {
        require(side != NoteSide.OVER || !on.isNullOrBlank()) { "A note over a participant needs the participant: pass on" }
        emit(Note(id = "", text = text, over = on, placement = side, startedAt = at))
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
                startedAt = at,
            ),
        )
    }

    /** End the innermost activation bar on [participant]. */
    @JvmOverloads
    public fun deactivate(participant: String, at: Instant? = null) {
        emit(Lifeline(id = "", participantId = participant, action = LifelineAction.DEACTIVATE, startedAt = at))
    }

    /** A titled section. The diagram continues and activations stay open across it. */
    @JvmOverloads
    public fun section(title: String, at: Instant? = null) {
        emit(Section(id = "", title = title, startedAt = at))
    }

    /** A labelled divider line across the diagram. */
    @JvmOverloads
    public fun divider(label: String, at: Instant? = null) {
        emit(Divider(id = "", label = label, startedAt = at))
    }

    /** A gap that stands for time passing, optionally labelled. */
    @JvmOverloads
    public fun delay(label: String? = null, at: Instant? = null) {
        emit(Delay(id = "", label = label, startedAt = at))
    }

    /** Extra vertical space, [heightPx] high or the report's default. */
    @JvmOverloads
    public fun spacer(heightPx: Int? = null, at: Instant? = null) {
        emit(Spacer(id = "", heightPx = heightPx, startedAt = at))
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

    private fun emit(event: SequenceEvent) = emit(listOf(event))

    private fun Interaction.toMessage(): Message {
        val base =
            when (kind) {
                InteractionKind.REQUEST, InteractionKind.MESSAGE -> MessageType.SYNCHRONOUS
                InteractionKind.RESPONSE -> MessageType.SYNCHRONOUS_RESPONSE
                InteractionKind.PUBLISH, InteractionKind.CONSUME -> MessageType.ASYNCHRONOUS
            }
        val type =
            when {
                from == null && to != null -> MessageType.SHORT_INBOUND
                to == null && from != null -> MessageType.SHORT_OUTBOUND
                else -> base
            }
        val opens = kind == InteractionKind.REQUEST || kind == InteractionKind.PUBLISH
        return Message(
            id = "",
            from = from,
            to = to,
            label = label,
            type = type,
            data = payload(),
            startedAt = startedAt,
            durationMs = durationMs?.takeIf { it > 0.0 && it.isFinite() },
            source = source,
            trace = trace,
            callRef = if (opens) CallRef(interactionId) else null,
            replyTo = if (kind == InteractionKind.RESPONSE) replyTo?.let(CallRef::of) else null,
            causedBy = if (kind == InteractionKind.CONSUME) replyTo?.let(CallRef::of) else null,
            status = status,
            orderHint = orderByStartedAt,
        )
    }

    /** The body, or headers and body together when the interaction has headers. */
    private fun Interaction.payload(): Any? =
        if (headers.isNullOrEmpty()) {
            data
        } else {
            buildMap {
                put("headers", headers)
                if (data != null) put("body", data)
            }
        }

    /** Record [events] in order. Ids are assigned here, from the context's generator. */
    internal abstract fun emit(events: List<SequenceEvent>)

    internal abstract fun fact(key: String, value: String)

    /** Capture [request] and return the call that waits for its reply. */
    internal abstract fun startCall(request: Message): PendingCall
}

/** Apply the caller's [timing] and [trace] to a captured message. */
internal fun Message.withTiming(
    timing: Timing?,
    trace: Trace?,
): Message =
    if (timing == null && trace == null) {
        this
    } else {
        copy(
            startedAt = timing?.startedAt ?: startedAt,
            durationMs = timing?.durationMs ?: durationMs,
            source = timing?.source ?: source,
            orderHint = timing?.orderByStartedAt ?: orderHint,
            trace = trace ?: this.trace,
        )
    }
