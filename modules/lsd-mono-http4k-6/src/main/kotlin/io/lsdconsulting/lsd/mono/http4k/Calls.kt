package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import org.http4k.core.HttpMessage
import org.http4k.core.Request
import org.http4k.core.Status
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadLocalRandom
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.Level
import java.util.logging.Logger

/**
 * A call a client filter is making, until a server filter in this JVM takes it over. The server
 * draws a call it serves (it knows its own name); the client draws only one nobody else drew.
 */
internal class PendingCall(
    val id: String,
    val scenario: LsdScenario,
    val caller: String,
    val parent: String?,
) {
    private val taken = AtomicBoolean()

    /** True once, for the server filter that draws this call. */
    fun take(): Boolean = taken.compareAndSet(false, true)

    val isTaken: Boolean get() = taken.get()
}

/** A request a server filter is serving on this thread: who the app is, and the span it opened. */
internal class Serving(
    val scenario: LsdScenario,
    val app: String,
    val spanId: String,
    val passed: Request,
)

internal object Calls {
    const val SOURCE: String = "jvm"

    /** Who made a call, so the app's server filter names its caller (another app's client filter). */
    const val CALLER_HEADER: String = LsdHeaders.CALLER

    /** The span a call was made under, so the request it starts nests under the one it serves. */
    const val PARENT_SPAN_HEADER: String = LsdHeaders.PARENT_SPAN

    /** A client filter's call id, so a server filter in the same JVM can take the call over. */
    const val CALL_HEADER: String = "lsd-call"

    private val log = Logger.getLogger("io.lsdconsulting.lsd.mono.http4k")

    @Volatile private var warned = false

    val lsd: LsdContext get() = LsdContext.instance

    /** Calls made in this JVM that a server filter may still take over, by [CALL_HEADER]. */
    val pending: MutableMap<String, PendingCall> = ConcurrentHashMap()

    /** The call a client filter is making on this thread: an in-memory handler serves it here. */
    val pendingHere: ThreadLocal<PendingCall?> = ThreadLocal()

    val serving: ThreadLocal<Serving?> = ThreadLocal()

    fun newId(): String = "%016x".format(ThreadLocalRandom.current().nextLong())

    /** `lsd-scenario`, `lsd-caller` and the rest are ours: never drawn as the app's headers. */
    fun isOwnHeader(name: String): Boolean = name.lowercase().startsWith("lsd-")

    /** The message's headers as drawn: ours left out, repeated names joined. */
    fun headers(message: HttpMessage): Map<String, String> =
        message.headers
            .filterNot { isOwnHeader(it.first) }
            .groupBy({ it.first }, { it.second ?: "" })
            .mapValues { (_, values) -> values.joinToString(", ") }

    /** `GET /orders?page=2`. */
    fun label(request: Request): String {
        val query = request.uri.query
        return "${request.method} ${request.uri.path.ifEmpty { "/" }}${if (query.isEmpty()) "" else "?$query"}"
    }

    /** Milliseconds since [t0], a [System.nanoTime]. */
    fun elapsedMs(t0: Long): Double = (System.nanoTime() - t0) / 1_000_000.0

    /** `201 Created`. */
    fun statusLabel(status: Status): String = if (status.description.isBlank()) status.code.toString() else "${status.code} ${status.description}"

    /** Capture never breaks the app: a failure leaves the event out, with one warning. */
    inline fun <T> guarded(
        fallback: T,
        block: () -> T,
    ): T =
        try {
            block()
        } catch (e: VirtualMachineError) {
            throw e
        } catch (e: Throwable) {
            // Swallowing an interrupt would hide it from the app: keep the thread marked.
            if (e is InterruptedException) Thread.currentThread().interrupt()
            warnOnce(e)
            fallback
        }

    fun warnOnce(e: Throwable) {
        if (warned) {
            log.log(Level.FINE, "lsd-mono http4k capture failed", e)
        } else {
            warned = true
            log.log(Level.WARNING, "lsd-mono http4k capture failed; the event is left out of the diagram", e)
        }
    }
}
