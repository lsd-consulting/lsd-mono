package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.domain.Participant
import org.springframework.core.env.Environment
import java.lang.System.Logger.Level
import java.util.IdentityHashMap
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
    private val sending = ConcurrentHashMap<String, Sending>()
    private val environments = ConcurrentHashMap<LsdScenario, Environment>()

    /**
     * What this thread is doing for a scenario: serving a request on its server thread, or running
     * work handed to a pool or a reactive scheduler by one (see [capture] and [within]).
     */
    private val current = ThreadLocal<Current?>()

    /** The message a listener thread is handling, set when its consumer polls it (see [consuming]). */
    private val handling = ThreadLocal<Pair<LsdScenario, String>?>()

    /** The consume each record of this thread's last poll was drawn as, by the record itself (see [polled]). */
    private val polled = ThreadLocal<IdentityHashMap<Any, Pair<LsdScenario, String>>?>()
    private val log = System.getLogger("io.lsdconsulting.lsd.mono.springboot")

    @Volatile private var warned = false

    /** [environment] is the test's application context's, for what needs its names (see [environmentOf]). */
    fun started(
        scenario: LsdScenario,
        environment: Environment? = null,
    ) {
        environment?.let { environments[scenario] = it }
        running += scenario
    }

    fun finished(scenario: LsdScenario) {
        running -= scenario
        inbound.remove(scenario)
        declared.remove(scenario)
        published.values.removeIf { it == scenario }
        sending.values.removeIf { it.scenario == scenario }
        environments.remove(scenario)
    }

    /**
     * The environment of the Spring test that started [scenario]: null outside one. For what is
     * built outside the app's context, such as a `WebTestClient` bound to a controller.
     */
    fun environmentOf(scenario: LsdScenario): Environment? = environments[scenario]

    fun isRunning(scenario: LsdScenario): Boolean = scenario in running

    /** The scenario a request or call belongs to, or null: then the starter captures nothing. */
    fun resolve(headerValue: String? = null): LsdScenario? {
        val lsd = LsdContext.instance
        lsd.findScenarioByHeader(headerValue)?.let { return it }
        current()?.let { return it.scenario }
        lsd.currentScenario()?.takeIf { it in running }?.let { return it }
        return running.singleOrNull()
    }

    fun enter(scenario: LsdScenario, spanId: String) {
        inbound.computeIfAbsent(scenario) { ConcurrentLinkedDeque() }.addLast(spanId)
    }

    fun leave(scenario: LsdScenario, spanId: String) {
        inbound[scenario]?.removeLastOccurrence(spanId)
    }

    /**
     * Waits, up to [timeoutMs], for the requests [scenario] is serving to be answered. A reactive
     * server can hand the client its reply a moment before the filter sees the exchange end, so a
     * test that has its response can finish before that reply is drawn.
     */
    fun settle(
        scenario: LsdScenario,
        timeoutMs: Long = SETTLE_MS,
    ) {
        val until = System.nanoTime() + timeoutMs * 1_000_000
        while (inbound[scenario]?.isEmpty() == false && System.nanoTime() < until) Thread.sleep(2)
    }

    private const val SETTLE_MS = 1_000L

    /** The inbound request the app is serving in [scenario], the parent of its outbound calls. */
    fun serving(scenario: LsdScenario): String? = inbound[scenario]?.peekLast()

    /**
     * What the app is doing in [scenario] when it makes a call: the request or message this thread
     * (or the thread that handed it its work) is serving, or the message this thread's Kafka
     * consumer just polled. Null means the test itself is calling. With nothing on the thread, the
     * request the scenario entered last: right while it serves one request at a time.
     */
    fun parentOf(scenario: LsdScenario): String? {
        current()?.takeIf { it.scenario == scenario }?.let { return it.parent }
        handling.get()?.takeIf { it.first == scenario }?.let { return it.second }
        return serving(scenario)
    }

    /** A scenario and what the app is doing in it (null: the test itself), carried across threads. */
    data class Current(
        val scenario: LsdScenario,
        val parent: String?,
    )

    /** What this thread is doing, if its scenario is still running. */
    fun current(): Current? = current.get()?.takeIf { it.scenario in running }

    /** What this thread is doing, as set: for a context-propagation accessor to read and restore. */
    fun currentRaw(): Current? = current.get()

    fun setCurrent(value: Current?) {
        if (value == null) current.remove() else current.set(value)
    }

    /** What to carry to the thread that runs work handed off from this one, or null outside a scenario. */
    fun capture(): Current? = resolve()?.let { Current(it, parentOf(it)) }

    /** Run [block] doing [work] on this thread, then put back whatever was there. */
    fun <T> within(
        work: Current?,
        block: () -> T,
    ): T {
        if (work == null) return block()
        val previous = current.get()
        current.set(work)
        try {
            return block()
        } finally {
            setCurrent(previous)
        }
    }

    /** Kafka polls and runs the listener on one thread: what it polled last is what it is handling. */
    fun consuming(
        scenario: LsdScenario?,
        consumeId: String?,
    ) {
        if (scenario == null || consumeId == null) handling.remove() else handling.set(scenario to consumeId)
    }

    /**
     * The consumes this thread's consumer drew for the records of its last poll. The listener
     * container hands the listener those same records, so [handle] can point its calls at the
     * right one. Replaced by each poll, so it holds no more than one poll's records.
     */
    fun polled(consumes: IdentityHashMap<Any, Pair<LsdScenario, String>>?) {
        if (consumes.isNullOrEmpty()) polled.remove() else polled.set(consumes)
    }

    /**
     * The listener is about to handle [record]: its calls belong to that record's consume. False,
     * leaving things as they were, when this thread's last poll drew no consume for it.
     */
    fun handle(record: Any?): Boolean {
        val consume = record?.let { polled.get()?.get(it) }?.takeIf { it.first in running } ?: return false
        handling.set(consume)
        return true
    }

    /** Remember which scenario sent a message, so its consumer joins the same diagram. */
    fun published(
        publishId: String,
        scenario: LsdScenario,
    ) {
        published[publishId] = scenario
    }

    fun publishedBy(publishId: String?): LsdScenario? = publishId?.let { published[it] }?.takeIf { it in running }

    /** A publish waiting for the broker's acknowledgement, which Kafka reports on another thread. */
    class Sending(
        val scenario: LsdScenario,
        val publisher: String,
        val topic: String,
        val sentAt: Long,
    )

    fun sending(
        publishId: String,
        send: Sending,
    ) {
        sending[publishId] = send
    }

    /**
     * The publish [publishId] acknowledges, once: null when it is unknown, already acknowledged, or
     * its scenario has finished (then the late acknowledgement is dropped, see [finished]).
     */
    fun acknowledged(publishId: String?): Sending? = publishId?.let { sending.remove(it) }?.takeIf { it.scenario in running }

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
            // Dropped, but the thread's interrupt is not: whoever interrupted it still sees it.
            if (e is InterruptedException) Thread.currentThread().interrupt()
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
