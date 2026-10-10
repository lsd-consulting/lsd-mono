package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import java.time.Instant

/** Stops a nested block's lambda from reaching an outer block's verbs by accident. */
@DslMarker
@Target(AnnotationTarget.CLASS)
internal annotation class LsdDsl

/**
 * The receiver of `capture { }`: several events captured together.
 *
 * ```kotlin
 * lsd.capture {
 *     "Customer" calls "Orders" label "POST /orders" data body took 412
 *     activate("Orders")
 *     "Orders" sends "order-events" label "order.paid"
 *     note("idempotent by orderId", on = "Orders")
 *     "Orders" repliesTo "Customer" label "201 Created"
 *     deactivate("Orders")
 * }
 * ```
 *
 * The arrows ([calls], [repliesTo], [sends]) exist only here, and every [Capturer] verb
 * works too. The block picks its scenario once, when it starts, and adds its events
 * together when it ends, even if it throws, so other threads' events never land between
 * them. Message data is copied when its line runs. Facts are added at once.
 *
 * Use the receiver only inside the block, on the block's thread. Once the block has
 * ended, calls on it throw.
 */
@LsdDsl
public class CaptureBlock internal constructor(
    private val scenario: LsdScenario,
) : Capturer() {
    /** [SequenceEvent]s and [MessageSpec]s, in the order they were written. */
    private val entries = ArrayList<Any>()
    private var ended = false

    /** A synchronous call from this participant to [to]. */
    public infix fun String.calls(to: String): MessageSpec = spec(this, to, MessageType.SYNCHRONOUS)

    /** The response to a call, from this participant (the callee) to [to]. */
    public infix fun String.repliesTo(to: String): MessageSpec = spec(this, to, MessageType.SYNCHRONOUS_RESPONSE)

    /** An asynchronous message from this participant to [to], such as an event on a queue. */
    public infix fun String.sends(to: String): MessageSpec = spec(this, to, MessageType.ASYNCHRONOUS)

    private fun spec(
        from: String,
        to: String,
        type: MessageType,
    ): MessageSpec = MessageSpec(from, to, type, scenario.context.payloads::snapshot).also { add(it) }

    override fun emit(events: List<SequenceEvent>) {
        events.forEach { add(scenario.context.copyData(it)) }
    }

    override fun fact(key: String, value: String) {
        checkOpen()
        scenario.addFact(key, value)
    }

    private fun add(entry: Any) {
        checkOpen()
        entries.add(entry)
    }

    private fun checkOpen() = check(!ended) { "This capture block has ended; use its receiver only inside the block" }

    internal fun run(block: CaptureBlock.() -> Unit) {
        try {
            block()
        } finally {
            ended = true
            val events = entries.map { if (it is MessageSpec) it.toMessage() else it as SequenceEvent }
            scenario.context.captureInto(scenario, events, dataCopied = true)
        }
    }
}

/**
 * A message written with an arrow in a [CaptureBlock], such as
 * `"A" calls "B" label "GET /x" data body took 12`. The block captures it when it ends.
 */
public class MessageSpec internal constructor(
    private val from: String,
    private val to: String,
    private val type: MessageType,
    private val copy: (Any?) -> Any?,
) {
    private var label = ""
    private var data: Any? = null
    private var durationMs: Long? = null
    private var colour: String? = null
    private var at: Instant? = null

    /** The text on the arrow. */
    public infix fun label(text: String): MessageSpec = apply { label = text }

    /** The payload shown in the inspector. It is copied now, so later changes don't reach the report. */
    public infix fun data(value: Any?): MessageSpec = apply { data = copy(value) }

    /** How long the call took, for the metrics. */
    public infix fun took(ms: Long): MessageSpec = apply { durationMs = ms }

    /** The arrow's colour, such as `#dc2626`. */
    public infix fun colour(css: String): MessageSpec = apply { colour = css }

    /** When it happened, for capture that arrives out of order. */
    public infix fun at(instant: Instant): MessageSpec = apply { at = instant }

    internal fun toMessage(): Message =
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
        )
}
