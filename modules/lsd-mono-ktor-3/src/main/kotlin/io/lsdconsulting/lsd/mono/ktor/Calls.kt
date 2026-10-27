package io.lsdconsulting.lsd.mono.ktor

import io.ktor.http.Headers
import io.ktor.http.HttpStatusCode
import io.lsdconsulting.lsd.mono.core.LsdBinding
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdHeaders
import io.lsdconsulting.lsd.mono.core.LsdScenario
import kotlinx.coroutines.ThreadContextElement
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ThreadLocalRandom
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.Level
import java.util.logging.Logger
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.cancellation.CancellationException

/**
 * A call the client plugin is making, until the server plugin in this JVM takes it over. The
 * server draws a call it serves (it knows its own name); the client draws only one nobody else drew.
 */
internal class PendingCall(
    val id: String,
    val scenario: LsdScenario,
    val caller: String,
    val parent: String?,
) {
    private val taken = AtomicBoolean()

    /** Set once the call's reply is drawn, by whichever plugin draws it. */
    val replied: AtomicBoolean = AtomicBoolean()

    /** The name the server plugin that took the call serves as. */
    @Volatile var server: String? = null
        private set

    /** True once, for the server plugin, serving as [app], that draws this call. */
    fun take(app: String): Boolean = taken.compareAndSet(false, true).also { if (it) server = app }

    val isTaken: Boolean get() = taken.get()
}

/** A call the server plugin is serving: who the app is, and the span its own calls nest under. */
internal class Serving(
    val scenario: LsdScenario,
    val app: String,
    private val span: () -> String,
) {
    val spanId: String get() = span()
}

/**
 * Carries [serving] with the coroutine that serves a call, so the client plugin draws the app's
 * own calls from it, and keeps the scenario bound to whichever thread that coroutine runs on.
 */
internal class ServingElement(
    val serving: Serving,
) : AbstractCoroutineContextElement(Key),
    ThreadContextElement<LsdBinding> {
    override fun updateThreadContext(context: CoroutineContext): LsdBinding = serving.scenario.bind()

    override fun restoreThreadContext(
        context: CoroutineContext,
        oldState: LsdBinding,
    ) {
        oldState.close()
    }

    companion object Key : CoroutineContext.Key<ServingElement>
}

internal object Calls {
    const val SOURCE: String = "jvm"

    /** Who made a call, so the app's server plugin names its caller (another app's client plugin). */
    const val CALLER_HEADER: String = LsdHeaders.CALLER

    /** The span a call was made under, so the request it starts nests under the one it serves. */
    const val PARENT_SPAN_HEADER: String = LsdHeaders.PARENT_SPAN

    /** The client plugin's call id, so the server plugin in the same JVM can take the call over. */
    const val CALL_HEADER: String = "lsd-call"

    /** The headers the client plugin adds, dropped from a copy of a request it tagged. */
    val OWN_HEADERS: List<String> = listOf(LsdHeaders.SCENARIO, CALLER_HEADER, CALL_HEADER, PARENT_SPAN_HEADER)

    /**
     * The failure the caller sees: the cause of a cancellation, when it has one (a timeout
     * cancels the call with a `HttpRequestTimeoutException`), else [e] itself.
     */
    fun cause(e: Throwable): Throwable =
        generateSequence(e) { it.cause?.takeIf { cause -> cause !== it } }.take(MAX_CAUSES).firstOrNull { it !is CancellationException } ?: e

    private const val MAX_CAUSES = 8

    private val log = Logger.getLogger("io.lsdconsulting.lsd.mono.ktor")

    @Volatile private var warned = false

    val lsd: LsdContext get() = LsdContext.instance

    /** Calls made in this JVM that the server plugin may still take over, by [CALL_HEADER]. */
    val pending: MutableMap<String, PendingCall> = ConcurrentHashMap()

    fun newId(): String = "%016x".format(ThreadLocalRandom.current().nextLong())

    /** `lsd-scenario`, `lsd-caller` and the rest are ours: never drawn as the app's headers. */
    fun isOwnHeader(name: String): Boolean = name.lowercase().startsWith("lsd-")

    /** The headers as drawn: ours left out, repeated names joined. */
    fun headers(vararg all: Headers): Map<String, String> {
        val drawn = LinkedHashMap<String, String>()
        for (headers in all) {
            headers.forEach { name, values ->
                if (!isOwnHeader(name) && drawn.keys.none { it.equals(name, ignoreCase = true) }) {
                    drawn[name] = values.joinToString(", ")
                }
            }
        }
        return drawn
    }

    /** `GET /orders?page=2`. */
    fun label(
        method: String,
        path: String,
        query: String,
    ): String = "$method ${path.ifEmpty { "/" }}${if (query.isEmpty()) "" else "?$query"}"

    /** Milliseconds since [t0], a [System.nanoTime]. */
    fun elapsedMs(t0: Long): Double = (System.nanoTime() - t0) / 1_000_000.0

    /** `201 Created`. */
    fun statusLabel(status: HttpStatusCode): String =
        if (status.description.isBlank()) status.value.toString() else "${status.value} ${status.description}"

    /** Capture never breaks the app: a failure leaves the event out, with one warning. */
    inline fun <T> guarded(
        fallback: T,
        block: () -> T,
    ): T =
        try {
            block()
        } catch (e: VirtualMachineError) {
            throw e
        } catch (e: CancellationException) {
            // The coroutine is being cancelled: that is the app's to see, not ours to swallow.
            throw e
        } catch (e: Throwable) {
            // Swallowing an interrupt would hide it from the app: keep the thread marked.
            if (e is InterruptedException) Thread.currentThread().interrupt()
            warnOnce(e)
            fallback
        }

    fun warnOnce(e: Throwable) {
        if (warned) {
            log.log(Level.FINE, "lsd-mono ktor capture failed", e)
        } else {
            warned = true
            log.log(Level.WARNING, "lsd-mono ktor capture failed; the event is left out of the diagram", e)
        }
    }
}
