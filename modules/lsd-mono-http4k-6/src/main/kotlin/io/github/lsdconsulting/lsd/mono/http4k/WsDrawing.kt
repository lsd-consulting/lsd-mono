package io.github.lsdconsulting.lsd.mono.http4k

import io.github.lsdconsulting.lsd.mono.http4k.Calls.guarded
import io.github.lsdconsulting.lsd.mono.jvm.Interaction
import io.github.lsdconsulting.lsd.mono.jvm.InteractionKind
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import org.http4k.core.MemoryBody
import org.http4k.websocket.WsMessage
import org.http4k.websocket.WsStatus
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

    /** Draws [message] and returns its span id, or null when it is left out (over the cap, or closed). */
    fun message(
        from: String,
        to: String,
        message: WsMessage,
    ): String? =
        guarded(null) {
            if (closed.get()) return@guarded null
            if (drawn.incrementAndGet() > shown) {
                skipped.incrementAndGet()
                return@guarded null
            }
            val id = Calls.newId()
            val (label, data) = describe(message)
            scenario.ingest(
                Interaction
                    .builder(InteractionKind.MESSAGE, from, to, label)
                    .interactionId(id)
                    .source(Calls.SOURCE)
                    .startedAt(Instant.now())
                    .data(data)
                    .build(),
            )
            id
        }

    fun close(
        from: String,
        to: String,
        status: WsStatus,
    ) = guarded(Unit) {
        if (!closed.compareAndSet(false, true)) return@guarded
        val more = skipped.get()
        if (more > 0) scenario.note("… $more more WebSocket message${if (more == 1) "" else "s"} not drawn", on = noteOn)
        val why = status.description.takeIf { it.isNotBlank() }?.let { " $it" } ?: ""
        scenario.ingest(
            Interaction
                .builder(InteractionKind.MESSAGE, from, to, "close ${status.code}$why")
                .source(Calls.SOURCE)
                .startedAt(Instant.now())
                .build(),
        )
    }

    fun error(
        from: String,
        to: String,
        e: Throwable,
    ) = guarded(Unit) {
        scenario.ingest(
            Interaction
                .builder(InteractionKind.MESSAGE, from, to, e.javaClass.simpleName)
                .status("error")
                .source(Calls.SOURCE)
                .startedAt(Instant.now())
                .data(e.toString())
                .build(),
        )
    }

    companion object {
        const val TEXT_LABEL: String = "text message"

        /**
         * A message's label and what the popup shows. The label is short: the class it was
         * written from when [LsdHttp4k.labelled] wrote it, else `text message` or
         * `binary (3 bytes)`. A text message is shown whole in the popup (folded if it is JSON),
         * unless it is over the body limit.
         */
        fun describe(message: WsMessage): Pair<String, Any?> {
            val body = message.body
            if (body !is MemoryBody) return "binary stream" to null
            val view = body.payload.duplicate()
            val size = view.remaining()
            val name = MessageNames.of(message)
            if (message.mode == WsMessage.Mode.Binary) return (name ?: "binary ($size bytes)") to null
            val label = name ?: TEXT_LABEL
            // Too large to show, as for an HTTP body.
            if (size > Bodies.LIMIT) return label to mapOf("notShown" to "larger than ${Bodies.LIMIT / 1024} KiB", "size" to size)
            val bytes = ByteArray(size).also { view.get(it) }
            return label to bytes.takeIf { it.isNotEmpty() }?.let { JsonText.parse(it) ?: it }
        }
    }
}
