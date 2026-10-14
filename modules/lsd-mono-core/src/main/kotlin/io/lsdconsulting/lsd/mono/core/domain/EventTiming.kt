package io.lsdconsulting.lsd.mono.core.domain

import io.lsdconsulting.lsd.mono.core.Accuracy
import io.lsdconsulting.lsd.mono.core.ClockOrdering
import io.lsdconsulting.lsd.mono.core.OrderSource
import io.lsdconsulting.lsd.mono.core.PairingSource
import io.lsdconsulting.lsd.mono.core.Timing
import io.lsdconsulting.lsd.mono.core.TimingSource
import java.time.Duration

/** Per-message timing facts, keyed by event id in [ScenarioTiming.perEvent]. */
internal data class EventTiming(
    val timing: TimingSource,
    /** Calls and replies only. */
    val pairing: PairingSource?,
    val order: OrderSource,
)

/** A scenario's timing summary. See the timing API notes, §2 and §4a. */
internal data class ScenarioTiming(
    val accuracy: Accuracy = Accuracy.STRUCTURE_ONLY,
    val measuredCoverage: Double? = null,
    val pairingCoverage: Double? = null,
    val sources: List<String> = emptyList(),
    val wallClockMs: Double? = null,
    val clockOrdering: ClockOrdering = ClockOrdering.SAME_SOURCE,
    val clockOrdered: Int = 0,
    val warnings: List<String> = emptyList(),
    val reorderedByClock: List<String> = emptyList(),
    val perEvent: Map<String, EventTiming> = emptyMap(),
)

private fun SequenceEvent.isCall() = this is Message && type == MessageType.SYNCHRONOUS

private fun SequenceEvent.isReply() = this is Message && type == MessageType.SYNCHRONOUS_RESPONSE

private fun SequenceEvent.source(): String = (this as? Message)?.source ?: Timing.LOCAL

/**
 * Pairs calls with replies, works out each message's timing and the scenario's accuracy, and
 * orders [captured] (capture order) for the report:
 *
 * 1. Capture order is the base.
 * 2. Under [mode] (default [ClockOrdering.SAME_SOURCE]) events with a `createdAt` and no measured
 *    duration are sorted by `(createdAt, capture order)` among the slots their group occupies, a
 *    group being one parent call and one source (or every source for [ClockOrdering.ALL_SOURCES]).
 *    Untimed events keep their slots. A per-message hint opts in (same source) or out.
 * 3. Structure wins: when clock order would put a reply before its call, a consume before its
 *    publish, or a child outside its parent call, the groups involved keep capture order and a
 *    `skew` warning is added.
 * Wall clock (`wallClockMs`) is given only for a single source where every measured call has a start.
 *
 * 4. When capture order itself is scrambled (interceptor threads, so replies arrive before their
 *    calls, or rule 3 had to give up), the structure is worked out again on a clock-sorted copy, and used when it is
 *    consistent and keeps every explicit `replyTo`/`causedBy` link in order.
 *
 * Moved events are marked [OrderSource.CLOCK]. Clock order never changes timing or raises accuracy.
 */
internal fun orderAndAnalyse(
    captured: List<SequenceEvent>,
    mode: ClockOrdering,
): Pair<List<SequenceEvent>, ScenarioTiming> {
    val first = analyse(captured, mode)
    if ((first.reverted || first.orphans > 0) && mode != ClockOrdering.OFF) {
        val flat = clockSorted(captured, mode)
        if (flat != captured) {
            val second = analyse(flat, mode)
            val better = second.orphans < first.orphans || (first.reverted && second.orphans == first.orphans)
            if (!second.reverted && better && linksHold(second.ordered)) return finish(captured, second, mode)
        }
    }
    return finish(captured, first, mode)
}

private class Analysis(
    val ordered: List<SequenceEvent>,
    val timing: Map<String, TimingSource>,
    val pairing: Map<String, PairingSource?>,
    val callMs: Map<String, Double>,
    val warnings: List<String>,
    val reverted: Boolean,
    /** Replies with no call. */
    val orphans: Int,
)

/** Every timed, unmeasured event of a scope sorted into that scope's slots, ignoring structure. */
private fun clockSorted(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
): List<SequenceEvent> {
    val scopes =
        events.indices
            .filter { i ->
                val e = events[i]
                val m = e as? Message
                e.createdAt != null && m?.orderHint != false && m?.timedMs == null
            }.groupBy { if (mode == ClockOrdering.ALL_SOURCES) "*" else events[it].source() }
    val order = IntArray(events.size) { it }
    scopes.values.forEach { slots ->
        val sorted = slots.sortedWith(compareBy<Int> { events[it].createdAt }.thenBy { it })
        slots.forEachIndexed { k, slot -> order[slot] = sorted[k] }
    }
    return order.map { events[it] }
}

/** Every explicit reply and consume comes after the call or publish it names. */
private fun linksHold(events: List<SequenceEvent>): Boolean {
    val position = HashMap<String, Int>()
    events.forEachIndexed { i, e -> (e as? Message)?.callRef?.id?.let { position.putIfAbsent(it, i) } }
    return events.withIndex().all { (i, e) ->
        val m = e as? Message ?: return@all true
        listOfNotNull(m.replyTo?.id, m.causedBy?.id).all { id -> (position[id] ?: -1) < i }
    }
}

private fun analyse(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
): Analysis {
    val n = events.size
    val warnings = mutableListOf<String>()
    val replyOf = IntArray(n) { -1 }
    val callOf = IntArray(n) { -1 }
    val pairing = arrayOfNulls<PairingSource>(n)
    val byCallId = HashMap<String, Int>()

    fun unpairedCall(j: Int) = events[j].isCall() && replyOf[j] < 0

    for (i in 0 until n) {
        val e = events[i] as? Message ?: continue
        if (e.isCall()) pairing[i] = PairingSource.NONE
        e.callRef?.id?.let { byCallId.putIfAbsent(it, i) }
        if (!e.isReply()) continue
        var c = -1
        var how = PairingSource.NONE
        val replyId = e.replyTo?.id
        if (replyId != null) {
            val j = byCallId[replyId]
            if (j != null && j < i && unpairedCall(j)) {
                c = j
                how = PairingSource.CALL_ID
            }
        }
        val span = e.trace?.spanId
        if (c < 0 && span != null) {
            c = (i - 1 downTo 0).firstOrNull { j ->
                val m = events[j] as? Message
                unpairedCall(j) && m?.trace?.spanId == span && m.trace.traceId == e.trace.traceId
            } ?: -1
            if (c >= 0) how = PairingSource.TRACE
        }
        if (c < 0 && replyId == null) {
            c = (i - 1 downTo 0).firstOrNull { j ->
                val m = events[j] as? Message
                m != null && unpairedCall(j) && m.from == e.to && m.to == e.from &&
                    (e.trace == null || m.trace == null || m.trace.traceId == e.trace.traceId)
            } ?: -1
            if (c >= 0) how = PairingSource.GUESSED
        }
        if (c >= 0) {
            replyOf[c] = i
            callOf[i] = c
            pairing[c] = how
            pairing[i] = how
        } else {
            pairing[i] = PairingSource.NONE
            warnings += "reply without call: '${e.label}' (${e.from} to ${e.to})"
        }
    }

    // Durations belong to the call. A reply's duration is moved to its call.
    val callMs = arrayOfNulls<Double>(n)
    val derived = BooleanArray(n)
    for (i in 0 until n) {
        val m = events[i] as? Message ?: continue
        if (!m.isCall()) continue
        val reply = replyOf[i].takeIf { it >= 0 }?.let { events[it] as Message }
        val own = m.timedMs
        val theirs = reply?.timedMs
        if (own != null && theirs != null && reply.exactMs != null && m.exactMs != null) {
            warnings += "duration on reply dropped: '${m.label}' already has one"
        }
        callMs[i] = own ?: theirs
        derived[i] = if (own != null) m.derived else reply?.derived == true
    }

    val timing =
        Array(n) { i ->
            val e = events[i]
            val m = e as? Message
            when {
                m == null -> if (e.createdAt != null) TimingSource.TIMESTAMPED else TimingSource.NONE
                m.isCall() && callMs[i] != null -> if (derived[i]) TimingSource.DERIVED else TimingSource.MEASURED
                callOf[i] < 0 && !m.isCall() && m.timedMs != null -> if (m.derived) TimingSource.DERIVED else TimingSource.MEASURED
                m.createdAt != null -> TimingSource.TIMESTAMPED
                else -> TimingSource.NONE
            }
        }

    // Parent call of each event: the innermost paired call open at its capture position.
    val parent = IntArray(n) { -1 }
    val open = ArrayList<Int>()
    for (i in 0 until n) {
        val c = callOf[i]
        if (c >= 0) {
            parent[i] = parent[c]
            open.remove(c)
            continue
        }
        parent[i] = open.lastOrNull() ?: -1
        if (replyOf[i] >= 0) open.add(i)
    }

    fun groupOf(i: Int): String? {
        val e = events[i]
        e.createdAt ?: return null
        val hint = (e as? Message)?.orderHint
        if (hint == false) return null
        if (mode == ClockOrdering.OFF && hint != true) return null
        if (e.isCall() && callMs[i] != null) return null
        if (callOf[i] >= 0 && callMs[callOf[i]] != null) return null
        val scope = if (mode == ClockOrdering.ALL_SOURCES && hint != true) "*" else e.source()
        return "${parent[i]}|$scope"
    }

    val groups = (0 until n).mapNotNull { i -> groupOf(i)?.let { it to i } }.groupBy({ it.first }, { it.second })
    val order = IntArray(n) { it }
    groups.values.forEach { slots ->
        val sorted = slots.sortedWith(compareBy<Int> { events[it].createdAt }.thenBy { it })
        slots.forEachIndexed { k, slot -> order[slot] = sorted[k] }
    }

    val reverted = mutableSetOf<String>()
    var rounds = groups.size + 1
    while (rounds-- > 0) {
        val pos = IntArray(n)
        order.forEachIndexed { p, orig -> pos[orig] = p }
        val bad = mutableSetOf<String>()

        fun flag(vararg idx: Int) = idx.filter { it >= 0 }.mapNotNullTo(bad) { groupOf(it)?.takeIf { g -> g !in reverted } }
        for (i in 0 until n) {
            val c = callOf[i]
            if (c >= 0 && pos[i] < pos[c]) flag(i, c)
            val pub = (events[i] as? Message)?.causedBy?.id?.let { byCallId[it] }
            if (pub != null && pos[i] < pos[pub]) flag(i, pub)
            val p = parent[i]
            if (p >= 0) {
                val r = replyOf[p]
                if (pos[i] < pos[p] || (r >= 0 && pos[i] > pos[r])) flag(i, p, r)
            }
        }
        if (bad.isEmpty()) break
        bad.forEach { g -> groups[g]?.forEach { order[it] = it } }
        reverted += bad
    }
    if (reverted.isNotEmpty()) {
        val count = reverted.sumOf { groups[it]?.size ?: 0 }
        warnings += "skew: clock order ignored for $count events, as it would put a reply before its call, " +
            "a consume before its publish, or a child outside its parent; capture order kept"
    }

    return Analysis(
        ordered = order.map { events[it] },
        timing = (0 until n).associate { events[it].id to timing[it] },
        pairing = (0 until n).associate { events[it].id to pairing[it] },
        callMs = (0 until n).mapNotNull { i -> callMs[i]?.let { events[i].id to it } }.toMap(),
        warnings = warnings,
        reverted = reverted.isNotEmpty(),
        orphans = warnings.count { it.startsWith("reply without call") },
    )
}

private fun finish(
    captured: List<SequenceEvent>,
    analysis: Analysis,
    mode: ClockOrdering,
): Pair<List<SequenceEvent>, ScenarioTiming> {
    val original = HashMap<String, Int>()
    captured.forEachIndexed { i, e -> original.putIfAbsent(e.id, i) }
    val ordered = analysis.ordered
    val perEvent = LinkedHashMap<String, EventTiming>()
    val reorders = mutableListOf<String>()
    var clockOrdered = 0
    ordered.forEachIndexed { p, e ->
        val from = original[e.id] ?: p
        val pairing = analysis.pairing[e.id]
        val how =
            when {
                from != p -> {
                    clockOrdered++
                    reorders += "${seqOf(e, from)} -> ${seqOf(captured[p], p)}"
                    OrderSource.CLOCK
                }
                pairing == PairingSource.CALL_ID || pairing == PairingSource.TRACE -> OrderSource.STRUCTURE
                else -> OrderSource.SEQUENCE
            }
        perEvent[e.id] = EventTiming(analysis.timing[e.id] ?: TimingSource.NONE, pairing, how)
    }
    val calls = ordered.filter { it.isCall() }
    val measured = calls.count { analysis.timing[it.id] == TimingSource.MEASURED }
    val strongPairs = calls.count { analysis.pairing[it.id] == PairingSource.CALL_ID || analysis.pairing[it.id] == PairingSource.TRACE }
    val timings = analysis.timing.values
    val anyStamp = timings.any { it == TimingSource.TIMESTAMPED || it == TimingSource.DERIVED }
    val anyMeasured = timings.any { it == TimingSource.MEASURED }
    val accuracy =
        when {
            anyMeasured && calls.isNotEmpty() && strongPairs == calls.size -> Accuracy.TRACED
            anyMeasured -> Accuracy.MEASURED
            anyStamp -> Accuracy.TIMESTAMPED
            else -> Accuracy.STRUCTURE_ONLY
        }
    val sources = captured.filterIsInstance<Message>().map { it.source() }.distinct()
    return ordered to
        ScenarioTiming(
            accuracy = accuracy,
            measuredCoverage = if (calls.isEmpty()) null else measured.toDouble() / calls.size,
            pairingCoverage = if (calls.isEmpty()) null else strongPairs.toDouble() / calls.size,
            sources = sources,
            wallClockMs = if (sources.size == 1) wallClock(ordered, analysis.callMs) else null,
            clockOrdering = mode,
            clockOrdered = clockOrdered,
            warnings = analysis.warnings,
            reorderedByClock = reorders,
            perEvent = perEvent,
        )
}

private fun seqOf(e: SequenceEvent, index: Int): Long = (e as? Message)?.seq?.takeIf { it > 0 } ?: (index + 1).toLong()

/** Span from the earliest `startedAt` to the latest start or end, single source only. */
private fun wallClock(
    events: List<SequenceEvent>,
    callMs: Map<String, Double>,
): Double? {
    // A measured call with no start time could sit anywhere, so the span would be a guess.
    if (callMs.keys.any { id -> events.firstOrNull { it.id == id }?.createdAt == null }) return null
    val starts = events.mapNotNull { e -> e.createdAt?.let { e.id to it } }
    if (starts.size < 2 && starts.none { callMs[it.first] != null }) return null
    val first = starts.minOfOrNull { it.second } ?: return null
    val last =
        starts.maxOf { (id, at) ->
            val ms = callMs[id] ?: 0.0
            at.plus(Duration.ofNanos((ms * 1_000_000).toLong()))
        }
    return Duration.between(first, last).toNanos() / 1_000_000.0
}
