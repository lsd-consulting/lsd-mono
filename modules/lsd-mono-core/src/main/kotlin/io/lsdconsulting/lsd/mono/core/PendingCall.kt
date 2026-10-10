package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import java.time.Duration
import java.time.Instant
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
 * arrives after that is dropped. Thread-safe.
 */
public class PendingCall internal constructor(
    private val scenario: LsdScenario,
    private val request: Message,
    private val deliver: (Message) -> Unit,
) {
    private val started = System.nanoTime()
    private val state = AtomicReference(State.WAITING)

    /**
     * Capture the response, from the callee back to the caller. The duration is the time
     * since [Capturer.call], or the time between the two `at`s when both were given.
     */
    @JvmOverloads
    public fun reply(
        label: String = "",
        data: Any? = null,
        at: Instant? = null,
    ) {
        respond(label, data, at)
    }

    /**
     * Capture an error response for [error]: labelled with the exception's simple name,
     * with the class name and message as its data. Use it when the call threw.
     */
    @JvmOverloads
    public fun fail(
        error: Throwable,
        at: Instant? = null,
    ) {
        val type = error.javaClass
        respond(type.simpleName.ifEmpty { type.name }, mapOf("exception" to type.name, "message" to error.message), at)
    }

    private fun respond(
        label: String,
        data: Any?,
        at: Instant?,
    ) {
        if (state.compareAndSet(State.WAITING, State.REPLIED)) {
            scenario.callEnded(this)
            deliver(
                Message(
                    id = "",
                    from = request.to,
                    to = request.from,
                    label = label,
                    type = MessageType.SYNCHRONOUS_RESPONSE,
                    data = data,
                    durationMs = durationMs(at),
                    createdAt = at,
                ),
            )
        } else if (state.get() == State.ABANDONED) {
            scenario.context.warnLate(scenario, "reply to ${describe()}")
        } else {
            scenario.context.warnDoubleReply(describe())
        }
    }

    private fun durationMs(at: Instant?): Long {
        val sent = request.createdAt
        if (sent != null && at != null) return Duration.between(sent, at).toMillis().coerceAtLeast(0)
        return (System.nanoTime() - started) / 1_000_000
    }

    /** Give up waiting, because the scenario completed. False if it was already replied to. */
    internal fun abandon(): Boolean = state.compareAndSet(State.WAITING, State.ABANDONED)

    internal fun describe(): String = "'${request.label}' (${request.from} to ${request.to})"

    override fun toString(): String = "PendingCall(${describe()}, ${state.get()})"

    private enum class State { WAITING, REPLIED, ABANDONED }
}
