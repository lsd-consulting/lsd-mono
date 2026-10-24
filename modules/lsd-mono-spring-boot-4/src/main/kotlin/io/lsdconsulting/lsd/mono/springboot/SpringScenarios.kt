package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.domain.Participant
import java.lang.System.Logger.Level
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedDeque
import java.util.concurrent.CopyOnWriteArrayList

/**
 * The scenarios the test listener has running, and which inbound request each one is serving.
 *
 * A request reaches the app on a server thread and its outbound calls often run on a pool, so
 * neither is bound to the test's scenario. A request carries its scenario in `lsd-scenario` when
 * our own client sent it; otherwise, with one test running (the usual case), that is the one.
 */
internal object SpringScenarios {
    /** Clock source for every event the starter captures: one JVM, one clock. */
    const val SOURCE: String = "jvm"

    /** Who sent a request, set by our client interceptor so another app's filter can name it. */
    const val CALLER_HEADER: String = "lsd-caller"

    private val running = CopyOnWriteArrayList<LsdScenario>()
    private val inbound = ConcurrentHashMap<LsdScenario, ConcurrentLinkedDeque<String>>()
    private val declared = ConcurrentHashMap<LsdScenario, MutableSet<String>>()
    private val published = ConcurrentHashMap<String, LsdScenario>()

    /** The message a listener thread is handling, set when its consumer polls it (see [consuming]). */
    private val handling = ThreadLocal<Pair<LsdScenario, String>?>()
    private val log = System.getLogger("io.lsdconsulting.lsd.mono.springboot")

    @Volatile private var warned = false

    fun started(scenario: LsdScenario) {
        running += scenario
    }

    fun finished(scenario: LsdScenario) {
        running -= scenario
        inbound.remove(scenario)
        declared.remove(scenario)
        published.values.removeIf { it == scenario }
    }

    fun isRunning(scenario: LsdScenario): Boolean = scenario in running

    /** The scenario a request or call belongs to, or null: then the starter captures nothing. */
    fun resolve(headerValue: String? = null): LsdScenario? {
        val lsd = LsdContext.instance
        lsd.findScenarioByHeader(headerValue)?.let { return it }
        lsd.currentScenario()?.takeIf { it in running }?.let { return it }
        return running.singleOrNull()
    }

    fun enter(scenario: LsdScenario, spanId: String) {
        inbound.computeIfAbsent(scenario) { ConcurrentLinkedDeque() }.addLast(spanId)
    }

    fun leave(scenario: LsdScenario, spanId: String) {
        inbound[scenario]?.removeLastOccurrence(spanId)
    }

    /** The inbound request the app is serving in [scenario], the parent of its outbound calls. */
    fun serving(scenario: LsdScenario): String? = inbound[scenario]?.peekLast()

    /**
     * What the app is doing in [scenario] when it makes a call: serving a request, or handling a
     * message this thread's Kafka consumer just polled. Null means the test itself is calling.
     */
    fun parentOf(scenario: LsdScenario): String? =
        serving(scenario) ?: handling.get()?.takeIf { it.first == scenario }?.second

    /** Kafka polls and runs the listener on one thread: what it polled last is what it is handling. */
    fun consuming(
        scenario: LsdScenario?,
        consumeId: String?,
    ) {
        if (scenario == null || consumeId == null) handling.remove() else handling.set(scenario to consumeId)
    }

    /** Remember which scenario sent a message, so its consumer joins the same diagram. */
    fun published(
        publishId: String,
        scenario: LsdScenario,
    ) {
        published[publishId] = scenario
    }

    fun publishedBy(publishId: String?): LsdScenario? = publishId?.let { published[it] }?.takeIf { it in running }

    /** Give a participant its shape (topic, repository) once per scenario, before it is first drawn. */
    fun declare(
        scenario: LsdScenario,
        participant: Participant,
    ) {
        val seen = declared.computeIfAbsent(scenario) { ConcurrentHashMap.newKeySet() }
        if (seen.add(participant.name)) {
            scenario.bind().use { LsdContext.instance.addParticipants(participant) }
        }
    }

    /** The starter's own propagation headers are plumbing, not part of the conversation. */
    fun isOwnHeader(name: String): Boolean = name.startsWith("lsd-", ignoreCase = true)

    fun newId(): String = UUID
        .randomUUID()
        .toString()
        .replace("-", "")
        .take(16)

    /** Capture must never break the app or the test: log the first failure, drop the event. */
    inline fun <T> guarded(fallback: T, block: () -> T): T =
        try {
            block()
        } catch (e: VirtualMachineError) {
            throw e
        } catch (e: Throwable) {
            warnOnce(e)
            fallback
        }

    fun warnOnce(e: Throwable) {
        if (warned) {
            log.log(Level.DEBUG, "lsd-mono spring capture failed", e)
        } else {
            warned = true
            log.log(Level.WARNING, "lsd-mono spring capture failed; the event is left out of the diagram", e)
        }
    }
}
