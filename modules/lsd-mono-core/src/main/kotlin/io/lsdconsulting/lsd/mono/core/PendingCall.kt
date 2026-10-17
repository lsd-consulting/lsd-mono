package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import java.time.Duration
import java.util.concurrent.atomic.AtomicReference

/**
 * A synchronous call that has been captured and is waiting for its reply. Get one from
 * [Capturer.call]; finish it with [reply] or [fail].
 *
 * The reply goes into the scenario the call was made in, from whichever thread replies,
 * so an async HTTP client's callback lands in the right test. It is drawn from the callee
 * back to the caller, with the time since the call as its duration.
 *
 * Only the first [reply] or [fail] counts; a later one is ignored with a warning. A call
 * still waiting when its scenario completes is reported in a warning, and a reply that
 * arrives after that is dropped. Thread-safe, and never throws into the caller: a failure
 * while capturing the reply is logged and the reply dropped.
 */
public class PendingCall internal constructor(
    private val scenario: LsdScenario,
    private val request: Message,
    private val deliver: (Message) -> Unit,
    detached: Boolean = false,
) {
    private val started = System.nanoTime()

    /** The call's id: pass it as `replyTo` to pair a reply captured elsewhere. */
    public val ref: CallRef = request.callRef ?: CallRef(null)

    /** The call's id as a string; `""` if its capture failed. */
    public val callId: String get() = ref.callId
    private val state = AtomicReference(if (detached) State.DETACHED else State.WAITING)

    /**
     * Capture the response, from the callee back to the caller. The duration is the time
     * since [Capturer.call] (measured), or the time between the call's and the reply's
     * `startedAt` when both were given (derived), unless [timing] gives a measured duration.
     */
    @JvmOverloads
    public fun reply(
        label: String = "",
        data: Any? = null,
        timing: Timing? = null,
    ) {
        scenario.context.guarded("reply", { }) { respond(label, data, timing) }
    }

    /**
     * Capture an error response for [error]: labelled with the exception's simple name,
     * with the class name and message as its data. Use it when the call threw.
     */
    @JvmOverloads
    public fun fail(
        error: Throwable,
        timing: Timing? = null,
    ) {
        scenario.context.guarded("reply", { }) {
            val type = error.javaClass
            respond(type.simpleName.ifEmpty { type.name }, mapOf("exception" to type.name, "message" to error.message), timing)
        }
    }

    private fun respond(
        label: String,
        data: Any?,
        timing: Timing?,
    ) {
        val at = timing?.startedAt
        if (state.get() == State.DETACHED) return
        if (state.compareAndSet(State.WAITING, State.REPLIED)) {
            val elapsedMs = (System.nanoTime() - started) / 1_000_000.0
            scenario.callEnded(this)
            val sent = request.startedAt
            val bothTimed = sent != null && at != null && timing?.durationMs == null
            val exact =
                timing?.durationMs
                    ?: if (bothTimed) Duration.between(sent, at).toNanos().coerceAtLeast(0) / 1_000_000.0 else elapsedMs
            deliver(
                Message(
                    id = "",
                    from = request.to,
                    to = request.from,
                    label = label,
                    type = MessageType.SYNCHRONOUS_RESPONSE,
                    data = data,
                    startedAt = at,
                    durationMs = exact,
                    derived = bothTimed,
                    source = timing?.source ?: request.source,
                    trace = request.trace,
                    replyTo = ref,
                    orderHint = timing?.orderByStartedAt,
                ),
            )
        } else if (state.get() == State.ABANDONED) {
            scenario.context.warnLate(scenario, "reply to ${describe()}")
        } else {
            scenario.context.warnDoubleReply(describe())
        }
    }

    /** Give up waiting, because the scenario completed. False if it was already replied to. */
    internal fun abandon(): Boolean = state.compareAndSet(State.WAITING, State.ABANDONED)

    internal fun describe(): String = "'${request.label}' (${request.from} to ${request.to})"

    override fun toString(): String = "PendingCall(${describe()}, ${state.get()})"

    private enum class State { WAITING, REPLIED, ABANDONED, DETACHED }

    internal companion object {
        /** Stands in for a call whose capture failed (already logged): replies to it are ignored quietly. */
        fun detached(scenario: LsdScenario, request: Message): PendingCall = PendingCall(scenario, request, { }, detached = true)
    }
}
