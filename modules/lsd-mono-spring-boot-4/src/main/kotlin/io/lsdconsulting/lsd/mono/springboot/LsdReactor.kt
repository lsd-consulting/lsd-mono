package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdScenario
import org.springframework.core.io.buffer.DataBuffer
import reactor.util.context.ContextView
import java.io.ByteArrayOutputStream

/**
 * A reactive request hops threads (Netty event loop, `publishOn`, `subscribeOn`, a timer), so the
 * thread-bound scenario core keeps is not there when its calls go out. The inbound [LsdWebFilter]
 * writes the request it is serving into Reactor's context instead, and [LsdExchangeFilter] reads it
 * back on whichever thread the call is subscribed: the call joins the right scenario, under the
 * right request, even with several scenarios running at once.
 */
internal object LsdReactor {
    /** The scenario a reactive chain belongs to and the inbound request it is serving. */
    data class Serving(
        val scenario: LsdScenario,
        val spanId: String,
    )

    private val KEY: Any = Serving::class.java.name

    fun write(
        context: reactor.util.context.Context,
        serving: Serving,
    ): reactor.util.context.Context = context.put(KEY, serving)

    fun read(context: ContextView): Serving? = context.getOrDefault<Serving>(KEY, null)?.takeIf { SpringScenarios.isRunning(it.scenario) }
}

/**
 * Copies what passes through a body stream, up to [Bodies.LIMIT], without moving the stream's
 * read position: the app (or the server) still gets every byte. Past the limit it keeps nothing.
 */
internal class BodyTap {
    private val out = ByteArrayOutputStream()

    @Volatile var overflowed: Boolean = false
        private set

    fun copy(buffer: DataBuffer) {
        if (overflowed) return
        SpringScenarios.guarded(Unit) {
            val count = buffer.readableByteCount()
            if (out.size() + count > Bodies.LIMIT) {
                overflowed = true
                out.reset()
                return@guarded
            }
            buffer.readableByteBuffers().use { buffers ->
                for (bytes in buffers) {
                    val chunk = ByteArray(bytes.remaining())
                    bytes.get(chunk)
                    synchronized(out) { out.write(chunk) }
                }
            }
        }
    }

    /** What was copied, or null when the body was too large to keep. */
    fun bytes(): ByteArray? = if (overflowed) null else synchronized(out) { out.toByteArray() }
}
