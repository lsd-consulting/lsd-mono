package io.lsdconsulting.lsd.mono.core

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * The scenarios of one [LsdContext]: the running ones by key, the default scenario for unbound
 * captures, and which scenario each thread is bound to. [lock] is the context's report lock, so
 * starting a scenario and taking over the default scenario's captures stay atomic with the rest
 * of the context's report state.
 */
internal class ScenarioRegistry(
    private val context: LsdContext,
    private val lock: Any,
) {
    private val sequence = AtomicLong()
    private val active = ConcurrentHashMap<String, LsdScenario>()
    private val bound = ThreadBindings()

    /** Unbound captures with no scenario running. Completed by `completeScenario`, as before. */
    val defaultScenario = LsdScenario(context, key = "", reportKey = null, sequence = 0)

    @Volatile
    private var warnedAmbiguous = false

    fun begin(
        reportKey: String?,
        key: String,
        bindCurrentThread: Boolean,
    ): LsdScenario {
        val scenario = LsdScenario(context, key, reportKey, sequence.incrementAndGet())
        synchronized(lock) {
            check(!active.containsKey(key)) { "A scenario with key '$key' is already running" }
            if (active.isEmpty() && !defaultScenario.isEmpty()) scenario.addAll(defaultScenario.drain())
            active[key] = scenario
        }
        if (bindCurrentThread) bound.set(scenario)
        return scenario
    }

    fun current(): LsdScenario? = bound.get()?.takeIf { isActive(it) }

    fun find(key: String): LsdScenario? = active[key]

    fun findByCorrelationId(id: String): LsdScenario? = active.values.firstOrNull { it.correlationId == id }

    fun isActive(scenario: LsdScenario): Boolean = isDefault(scenario) || active[scenario.key] === scenario

    fun isDefault(scenario: LsdScenario): Boolean = scenario === defaultScenario

    fun isEmpty(): Boolean = active.isEmpty()

    /** Running scenarios of [reportKey], in the order they began. */
    fun running(reportKey: String?): List<LsdScenario> = active.values.filter { it.reportKey == reportKey }.sortedBy { it.sequence }

    /** Take [scenario] out of the running set. False if it was not running (already completed). */
    fun remove(scenario: LsdScenario): Boolean = active.remove(scenario.key, scenario)

    /** Unbind [scenario] from every thread that still points at it. */
    fun forget(scenario: LsdScenario) = bound.forget(scenario)

    fun bindThread(scenario: LsdScenario): LsdBinding = LsdBinding(bound.set(scenario))

    /** Order of a scenario completed from the default scenario, after every begun one so far. */
    fun nextOrder(): Long = sequence.incrementAndGet()

    /** Where an unscoped call goes: the bound scenario, the only running one, or the default. */
    fun target(): LsdScenario {
        current()?.let { return it }
        val running = active.values.toList()
        if (running.size == 1) return running.single()
        if (running.size > 1 && !warnedAmbiguous) {
            warnedAmbiguous = true
            CaptureLog.unattributed(running.size)
        }
        return defaultScenario
    }

    /** Abandon and forget every scenario. Call with [lock] held. */
    fun clear() {
        active.values.forEach { it.abandonCalls() }
        active.clear()
        defaultScenario.abandonCalls()
        defaultScenario.drain()
        warnedAmbiguous = false
    }

    /** Unbind the calling thread. */
    fun unbindCurrentThread() = bound.remove()
}
