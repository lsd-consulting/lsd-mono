package io.lsdconsulting.lsd.mono.ktor

import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.ktor.Calls.guarded
import java.time.Instant
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * What one WebSocket draws, either end of it: each message as an arrow (the first [shown]; the
 * rest are counted in a note on [noteOn] when it closes), the close from whichever side closed
 * first, and any error. Nothing is drawn after the close.
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

    /** Draws [frame] and returns its span id, or null when it is left out (over the cap, or closed). */
    fun message(
        from: String,
        to: String,
        frame: Frame,
        unread: String? = null,
    ): String? =
        guarded(null) {
            if (closed.get()) return@guarded null
            if (drawn.incrementAndGet() > shown) {
                skipped.incrementAndGet()
                return@guarded null
            }
            val id = Calls.newId()
            val (label, data) = describe(frame, unread)
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.MESSAGE,
                    from = from,
                    to = to,
                    label = label,
                    interactionId = id,
                    source = Calls.SOURCE,
                    startedAt = Instant.now(),
                    data = data,
                ),
            )
            id
        }

    /** Draws the close, once, after a note of the messages left out. */
    fun close(
        from: String,
        to: String,
        reason: CloseReason?,
    ) = guarded(Unit) {
        if (!closed.compareAndSet(false, true)) return@guarded
        val more = skipped.get()
        if (more > 0) scenario.note("… $more more WebSocket message${if (more == 1) "" else "s"} not drawn", on = noteOn)
        scenario.ingest(
            Interaction(
                kind = InteractionKind.MESSAGE,
                from = from,
                to = to,
                label = closeLabel(reason),
                source = Calls.SOURCE,
                startedAt = Instant.now(),
            ),
        )
    }

    fun error(
        from: String,
        to: String,
        e: Throwable,
    ) = guarded(Unit) {
        if (closed.get()) return@guarded
        scenario.ingest(
            Interaction(
                kind = InteractionKind.MESSAGE,
                from = from,
                to = to,
                label = e.javaClass.simpleName,
                status = "error",
                source = Calls.SOURCE,
                startedAt = Instant.now(),
                data = e.toString(),
            ),
        )
    }

    companion object {
        const val TEXT_LABEL: String = "text message"

        /** `close 1000 bye`, `close 1001 GOING_AWAY`, or `close` for a close frame with no code. */
        fun closeLabel(reason: CloseReason?): String {
            if (reason == null) return "close"
            val why = reason.message.takeIf { it.isNotBlank() } ?: reason.knownReason?.name
            return "close ${reason.code}${why?.let { " $it" } ?: ""}"
        }

        /**
         * A message's label and what the popup shows. The label is short: the class it was
         * written from when a converter wrapped by [LsdKtor.labelled] wrote it, else
         * `text message` or `binary (3 bytes)`. A text message is shown whole in the popup
         * (folded if it is JSON), unless it is over the body limit or [unread] says why its
         * bytes mean nothing as they are (compressed, or one fragment of a message).
         */
        fun describe(
            frame: Frame,
            unread: String? = null,
        ): Pair<String, Any?> {
            val bytes = frame.data
            val name = if (unread == null) MessageNames.of(frame) else null
            if (frame is Frame.Binary) return (name ?: "binary (${bytes.size} bytes)") to null
            val label = name ?: TEXT_LABEL
            if (unread != null) return label to mapOf("notShown" to unread, "size" to bytes.size)
            // Too large to show, as for an HTTP body.
            if (bytes.size > Bodies.LIMIT) return label to mapOf("notShown" to "larger than ${Bodies.LIMIT / 1024} KiB", "size" to bytes.size)
            return label to bytes.takeIf { it.isNotEmpty() }?.let { JsonText.parse(it) ?: it }
        }
    }
}
