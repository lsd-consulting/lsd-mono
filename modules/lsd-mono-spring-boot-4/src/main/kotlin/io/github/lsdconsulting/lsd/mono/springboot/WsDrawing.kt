package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.core.env.Environment
import org.springframework.web.socket.BinaryMessage
import org.springframework.web.socket.CloseStatus
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketMessage
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * What one WebSocket draws, either end of it: each message as an arrow (the first [shown]; the
 * rest are counted in a note on [noteOn] when it closes), the close from whichever side closed
 * first, and any error. Nothing is drawn after the close. Pings and pongs are not drawn.
 */
internal class WsDrawing(
    val scenario: LsdScenario,
    private val noteOn: String,
    private val shown: Int,
) {
    private val drawn = AtomicInteger()
    private val skipped = AtomicInteger()
    private val closed = AtomicBoolean()

    val isClosed: Boolean get() = closed.get()

    /** Draws [message] and returns its span id, or null when it is left out (a ping, over the cap, or closed). */
    fun message(
        from: String,
        to: String,
        message: WebSocketMessage<*>,
    ): String? =
        guarded(null) {
            val (label, data) = describe(message) ?: return@guarded null
            arrow(from, to, label, data)
        }

    /** Draws a message already described (a STOMP frame), under the same cap. */
    fun arrow(
        from: String,
        to: String,
        label: String,
        data: Any?,
        status: String? = null,
    ): String? =
        guarded(null) {
            if (closed.get() || !SpringScenarios.isRunning(scenario)) return@guarded null
            if (drawn.incrementAndGet() > shown) {
                skipped.incrementAndGet()
                return@guarded null
            }
            val id = SpringScenarios.newId()
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.MESSAGE,
                    from = from,
                    to = to,
                    label = label,
                    status = status,
                    interactionId = id,
                    source = SpringScenarios.SOURCE,
                    startedAt = Instant.now(),
                    data = data,
                ),
            )
            id
        }

    /** Draws the close, once: false when it was already drawn. */
    fun close(
        from: String,
        to: String,
        status: CloseStatus,
    ): Boolean =
        guarded(false) {
            if (!closed.compareAndSet(false, true)) return@guarded false
            if (!SpringScenarios.isRunning(scenario)) return@guarded true
            val more = skipped.get()
            if (more > 0) scenario.note("… $more more WebSocket message${if (more == 1) "" else "s"} not drawn", on = noteOn)
            val why = status.reason?.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.MESSAGE,
                    from = from,
                    to = to,
                    label = "close ${status.code}$why",
                    source = SpringScenarios.SOURCE,
                    startedAt = Instant.now(),
                ),
            )
            true
        }

    fun error(
        from: String,
        to: String,
        e: Throwable,
    ) = guarded(Unit) {
        if (closed.get() || !SpringScenarios.isRunning(scenario)) return@guarded
        scenario.ingest(
            Interaction(
                kind = InteractionKind.MESSAGE,
                from = from,
                to = to,
                label = e.javaClass.simpleName,
                status = "error",
                source = SpringScenarios.SOURCE,
                startedAt = Instant.now(),
                data = e.toString(),
            ),
        )
    }

    companion object {
        const val TEXT_LABEL: String = "text message"
        const val DEFAULT_SHOWN: Int = 20
        const val SHOWN_PROPERTY: String = "lsd.mono.spring.websocket.messages-shown"

        /** How many of a socket's messages are drawn: `lsd.mono.spring.websocket.messages-shown`, 20 by default. */
        fun shown(env: Environment): Int {
            val shown = env.getProperty(SHOWN_PROPERTY, Int::class.java, DEFAULT_SHOWN)
            require(shown >= 0) { "$SHOWN_PROPERTY must not be negative: $shown" }
            return shown
        }

        /**
         * A message's label and what the popup shows, or null for a ping or pong. The label is
         * short, `text message` or `binary (3 bytes)`: the app writes a raw message itself, so its
         * class is not known (STOMP frames are labelled with theirs, see [LsdStompOutbound]). A text message is shown
         * whole in the popup (folded if it is JSON), unless it is over the body limit.
         */
        fun describe(message: WebSocketMessage<*>): Pair<String, Any?>? =
            when (message) {
                is TextMessage -> {
                    TEXT_LABEL to popup(message.asBytes())
                }
                is BinaryMessage -> {
                    "binary (${message.payloadLength} bytes)" to null
                }
                else -> null
            }

        /** What the popup shows of a text payload: JSON as a tree, else the text; a note when it is too large. */
        fun popup(bytes: ByteArray): Any? =
            if (bytes.size > Bodies.LIMIT) {
                mapOf("notShown" to "larger than ${Bodies.LIMIT / 1024} KiB", "size" to bytes.size)
            } else {
                Bodies.read(bytes, "application/json")
            }
    }
}

/** The labels STOMP frames carry: the simple name of the class a payload was written from or read into. */
internal object MessageNames {
    /** The header [NamingMessageConverter] puts on each message it writes, naming the payload's class. */
    const val HEADER: String = "lsdPayloadType"

    /** `PriceChanged`; none for an anonymous class or a String, List or Map. */
    fun nameOf(type: Class<*>): String? {
        if (type.isArray || type.isPrimitive) return null
        val pkg = type.packageName
        if (pkg == "java" || pkg.startsWith("java.") || pkg == "kotlin" || pkg.startsWith("kotlin.")) return null
        return type.simpleName.takeIf { it.isNotEmpty() }
    }
}
