package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Fact
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Status
import java.util.concurrent.Callable
import java.util.function.Consumer

/**
 * One scenario being captured. Start one with [LsdContext.beginScenario].
 *
 * The thread that begins a scenario is bound to it, so captures through [LsdContext]
 * on that thread land here even when other scenarios run at the same time.
 * Work on other threads (an executor, an HTTP server thread) can use [bind] or
 * [wrap], or capture through this object directly.
 *
 * Every method is thread-safe.
 */
public class LsdScenario internal constructor(
    internal val context: LsdContext,
    /** Unique among the scenarios that are running. Integrations use the test's own id. */
    public val key: String,
    /**
     * Scenarios with the same report key go into the same report, written by
     * [LsdContext.completeReport] with that key. `null` is the default report.
     */
    public val reportKey: String?,
    internal val sequence: Long,
) : Capturer() {
    private val lock = Any()
    private val facts = ArrayList<Fact>()
    private val events = ArrayList<SequenceEvent>()
    private val waiting = LinkedHashSet<PendingCall>()
    private var closed = false

    /** True until the scenario is completed, discarded, or the context is cleared. */
    public val isActive: Boolean
        get() = context.isActive(this)

    /** Into this scenario, whichever thread calls it. */
    override fun emit(events: List<SequenceEvent>) {
        context.captureInto(this, events)
    }

    /** Capture several events together into this scenario. See [CaptureBlock]. */
    @JvmSynthetic
    public fun capture(block: CaptureBlock.() -> Unit): Unit = CaptureBlock(this).run(block)

    /** Java form of [capture]: `scenario.capture(c -> { c.message("A", "B"); c.activate("B"); })`. */
    public fun capture(block: Consumer<CaptureBlock>): Unit = capture { block.accept(this) }

    override fun startCall(request: Message): PendingCall {
        val call = PendingCall(this, request) { emit(listOf(it)) }
        track(call)
        emit(listOf(request))
        return call
    }

    internal fun track(call: PendingCall) {
        synchronized(lock) { waiting.add(call) }
    }

    internal fun callEnded(call: PendingCall) {
        synchronized(lock) { waiting.remove(call) }
    }

    /** Stop waiting for replies; returns the calls that never got one. */
    internal fun abandonCalls(): List<PendingCall> {
        val open = synchronized(lock) { waiting.toList().also { waiting.clear() } }
        return open.filter { it.abandon() }
    }

    override fun fact(key: String, value: String) {
        if (!add { facts.add(Fact(key, value)) }) context.warnLate(this, "fact")
    }

    /**
     * Bind the calling thread to this scenario until the returned handle is closed.
     * Closing restores whatever the thread was bound to before.
     */
    public fun bind(): LsdBinding = context.bindThread(this)

    /** A [Runnable] that runs [task] with its thread bound to this scenario. */
    public fun wrap(task: Runnable): Runnable = Runnable { bind().use { task.run() } }

    /** A [Callable] that runs [task] with its thread bound to this scenario. */
    public fun <T> wrap(task: Callable<T>): Callable<T> = Callable { bind().use { task.call() } }

    /**
     * Finish the scenario and keep it for the report named by [reportKey].
     * Captures that arrive afterwards are dropped with a warning. A second call does nothing.
     */
    @JvmOverloads
    public fun complete(
        title: String,
        description: String? = "",
        status: Status = Status.SUCCESS,
        error: ScenarioError? = null,
    ): Unit = context.complete(this, title, description, status, error)

    /** Stop capturing without writing a scenario. */
    public fun discard(): Unit = context.discard(this)

    internal fun addEvents(added: List<SequenceEvent>): Boolean = add { events.addAll(added) }

    /** Close and return what was captured. Later adds are refused. */
    internal fun close(): Pair<List<Fact>, List<SequenceEvent>> =
        synchronized(lock) {
            closed = true
            val snapshot = facts.toList() to events.toList()
            facts.clear()
            events.clear()
            snapshot
        }

    /** Snapshot and clear, but stay open. Used for the context's default scenario. */
    internal fun drain(): Pair<List<Fact>, List<SequenceEvent>> =
        synchronized(lock) {
            val snapshot = facts.toList() to events.toList()
            facts.clear()
            events.clear()
            snapshot
        }

    internal fun addAll(content: Pair<List<Fact>, List<SequenceEvent>>) =
        synchronized(lock) {
            facts.addAll(0, content.first)
            events.addAll(0, content.second)
        }

    internal fun isEmpty(): Boolean = synchronized(lock) { facts.isEmpty() && events.isEmpty() }

    private inline fun add(block: () -> Unit): Boolean =
        synchronized(lock) {
            if (closed) return false
            block()
            true
        }

    override fun toString(): String = "LsdScenario(key=$key, reportKey=$reportKey)"
}
