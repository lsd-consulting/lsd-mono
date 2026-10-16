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
    /** Each call's duration, its own or its reply's, by call id. The JSON writes it on the call. */
    val callMs: Map<String, Double> = emptyMap(),
    /** Replies paired with a call. Their duration belongs to the call, so the JSON leaves it off them. */
    val pairedReplies: Set<String> = emptySet(),
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
    val pairedReplies: Set<String>,
    val warnings: List<String>,
    val reverted: Boolean,
    /** Replies with no call. */
    val orphans: Int,
)

/**
 * Whether clock ordering may move [e]: it has a `createdAt`, is not [measured] (a measured call,
 * or the reply of one), is not opted out, and ordering is on or the event opts in.
 */
private fun clockEligible(
    e: SequenceEvent,
    mode: ClockOrdering,
    measured: Boolean,
): Boolean {
    if (e.createdAt == null || measured) return false
    val hint = (e as? Message)?.orderHint
    if (hint == false) return false
    return mode != ClockOrdering.OFF || hint == true
}

/** The clock domain [e] is compared in: its source, or every source under [ClockOrdering.ALL_SOURCES]. */
private fun clockScope(
    e: SequenceEvent,
    mode: ClockOrdering,
): String = if (mode == ClockOrdering.ALL_SOURCES && (e as? Message)?.orderHint != true) "*" else e.source()

/** Sort the events at [slots] by `(createdAt, capture position)` back into the same slots of [order]. */
private fun sortIntoSlots(
    events: List<SequenceEvent>,
    slots: List<Int>,
    order: IntArray,
) {
    val sorted = slots.sortedWith(compareBy<Int> { events[it].createdAt }.thenBy { it })
    slots.forEachIndexed { k, slot -> order[slot] = sorted[k] }
}

/** Every timed, unmeasured event of a scope sorted into that scope's slots, ignoring structure. */
private fun clockSorted(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
): List<SequenceEvent> {
    val order = IntArray(events.size) { it }
    events.indices
        .filter { clockEligible(events[it], mode, measured = (events[it] as? Message)?.timedMs != null) }
        .groupBy { clockScope(events[it], mode) }
        .values
        .forEach { sortIntoSlots(events, it, order) }
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

/** Calls paired with replies, by index into the events. */
private class Pairs(
    /** For a call, the index of its reply, else -1. */
    val replyOf: IntArray,
    /** For a reply, the index of its call, else -1. */
    val callOf: IntArray,
    /** Calls and replies only. */
    val pairing: Array<PairingSource?>,
    /** Call or publish id to the index of the event that carries it. */
    val byCallId: Map<String, Int>,
    val warnings: List<String>,
)

/** Pair each reply with a call: by `replyTo`, else by span id, else guessed by direction. */
private fun pairCalls(events: List<SequenceEvent>): Pairs {
    val n = events.size
    val warnings = mutableListOf<String>()
    val replyOf = IntArray(n) { -1 }
    val callOf = IntArray(n) { -1 }
    val pairing = arrayOfNulls<PairingSource>(n)
    val byCallId = HashMap<String, Int>()

    fun unpairedCall(j: Int) = events[j].isCall() && replyOf[j] < 0

    // Unpaired calls by span and by direction, latest last. Paired ones are dropped lazily.
    val bySpan = HashMap<Pair<String, String>, ArrayList<Int>>()
    val byDirection = HashMap<Pair<String?, String?>, ArrayList<Int>>()

    fun latest(
        calls: ArrayList<Int>?,
        accept: (Message) -> Boolean,
    ): Int {
        if (calls == null) return -1
        while (calls.isNotEmpty() && !unpairedCall(calls.last())) calls.removeAt(calls.size - 1)
        for (k in calls.indices.reversed()) {
            val j = calls[k]
            if (unpairedCall(j) && accept(events[j] as Message)) return j
        }
        return -1
    }

    for (i in 0 until n) {
        val e = events[i] as? Message ?: continue
        if (e.isCall()) {
            pairing[i] = PairingSource.NONE
            e.trace?.let { t -> t.spanId?.let { bySpan.getOrPut(t.traceId to it) { ArrayList() }.add(i) } }
            byDirection.getOrPut(e.from to e.to) { ArrayList() }.add(i)
        }
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
        val trace = e.trace
        val span = trace?.spanId
        if (c < 0 && span != null) {
            c = latest(bySpan[trace.traceId to span]) { true }
            if (c >= 0) how = PairingSource.TRACE
        }
        if (c < 0 && replyId == null) {
            c = latest(byDirection[e.to to e.from]) { m -> trace == null || m.trace == null || m.trace.traceId == trace.traceId }
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
    return Pairs(replyOf, callOf, pairing, byCallId, warnings)
}

/** Each call's duration: its own, else its reply's. [derived] marks durations computed from timestamps. */
private class CallDurations(
    val callMs: Array<Double?>,
    val derived: BooleanArray,
    val warnings: List<String>,
)

private fun callDurations(
    events: List<SequenceEvent>,
    pairs: Pairs,
): CallDurations {
    val n = events.size
    val warnings = mutableListOf<String>()
    val callMs = arrayOfNulls<Double>(n)
    val derived = BooleanArray(n)
    for (i in 0 until n) {
        val m = events[i] as? Message ?: continue
        if (!m.isCall()) continue
        val reply = pairs.replyOf[i].takeIf { it >= 0 }?.let { events[it] as Message }
        val own = m.timedMs
        val theirs = reply?.timedMs
        if (own != null && theirs != null && reply.exactMs != null && m.exactMs != null) {
            warnings += "duration on reply dropped: '${m.label}' already has one"
        }
        callMs[i] = own ?: theirs
        derived[i] = if (own != null) m.derived else reply?.derived == true
    }
    return CallDurations(callMs, derived, warnings)
}

private fun timingSources(
    events: List<SequenceEvent>,
    pairs: Pairs,
    durations: CallDurations,
): Array<TimingSource> =
    Array(events.size) { i ->
        val e = events[i]
        val m = e as? Message
        when {
            m == null -> if (e.createdAt != null) TimingSource.TIMESTAMPED else TimingSource.NONE
            m.isCall() && durations.callMs[i] != null -> if (durations.derived[i]) TimingSource.DERIVED else TimingSource.MEASURED
            pairs.callOf[i] < 0 && !m.isCall() && m.timedMs != null -> if (m.derived) TimingSource.DERIVED else TimingSource.MEASURED
            m.createdAt != null -> TimingSource.TIMESTAMPED
            else -> TimingSource.NONE
        }
    }

/** Parent call of each event: the innermost paired call open at its position. A reply shares its call's parent. */
private fun parentCalls(pairs: Pairs): IntArray {
    val n = pairs.callOf.size
    val parent = IntArray(n) { -1 }
    val open = ArrayList<Int>()
    for (i in 0 until n) {
        val c = pairs.callOf[i]
        if (c >= 0) {
            parent[i] = parent[c]
            open.remove(c)
            continue
        }
        parent[i] = open.lastOrNull() ?: -1
        if (pairs.replyOf[i] >= 0) open.add(i)
    }
    return parent
}

/**
 * Clock-order each group (parent call and scope) into its own slots, then undo any group whose
 * moves break structure: a reply before its call, a consume before its publish, or a child
 * outside its parent. Returns the order and the number of events in groups that were undone.
 */
private fun clockOrder(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
    pairs: Pairs,
    durations: CallDurations,
    parent: IntArray,
): Pair<IntArray, Int> {
    val n = events.size

    fun groupOf(i: Int): String? {
        val call = if (events[i].isCall()) i else pairs.callOf[i]
        val measured = call >= 0 && durations.callMs[call] != null
        if (!clockEligible(events[i], mode, measured)) return null
        return "${parent[i]}|${clockScope(events[i], mode)}"
    }
    val groupKeys = Array(n) { groupOf(it) }
    val groups = (0 until n).filter { groupKeys[it] != null }.groupBy { groupKeys[it]!! }
    val order = IntArray(n) { it }
    groups.values.forEach { sortIntoSlots(events, it, order) }

    val reverted = mutableSetOf<String>()
    var rounds = groups.size + 1
    while (rounds-- > 0) {
        val pos = IntArray(n)
        order.forEachIndexed { p, orig -> pos[orig] = p }
        val bad = mutableSetOf<String>()

        fun flag(vararg idx: Int) = idx.filter { it >= 0 }.mapNotNullTo(bad) { groupKeys[it]?.takeIf { g -> g !in reverted } }
        for (i in 0 until n) {
            val c = pairs.callOf[i]
            if (c >= 0 && pos[i] < pos[c]) flag(i, c)
            val pub = (events[i] as? Message)?.causedBy?.id?.let { pairs.byCallId[it] }
            if (pub != null && pos[i] < pos[pub]) flag(i, pub)
            val p = parent[i]
            if (p >= 0) {
                val r = pairs.replyOf[p]
                if (pos[i] < pos[p] || (r >= 0 && pos[i] > pos[r])) flag(i, p, r)
            }
        }
        if (bad.isEmpty()) break
        bad.forEach { g -> groups[g]?.forEach { order[it] = it } }
        reverted += bad
    }
    return order to reverted.sumOf { groups[it]?.size ?: 0 }
}

private fun analyse(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
): Analysis {
    val pairs = pairCalls(events)
    val durations = callDurations(events, pairs)
    val timing = timingSources(events, pairs, durations)
    val (order, undone) = clockOrder(events, mode, pairs, durations, parentCalls(pairs))
    val warnings = pairs.warnings + durations.warnings
    val skew =
        if (undone > 0) {
            listOf(
                "skew: clock order ignored for $undone events, as it would put a reply before its call, " +
                    "a consume before its publish, or a child outside its parent; capture order kept",
            )
        } else {
            emptyList()
        }
    return Analysis(
        ordered = order.map { events[it] },
        timing = events.indices.associate { events[it].id to timing[it] },
        pairing = events.indices.associate { events[it].id to pairs.pairing[it] },
        callMs = events.indices.mapNotNull { i -> durations.callMs[i]?.let { events[i].id to it } }.toMap(),
        pairedReplies = events.indices.filter { pairs.callOf[it] >= 0 }.mapTo(HashSet()) { events[it].id },
        warnings = warnings + skew,
        reverted = undone > 0,
        orphans = pairs.warnings.count { it.startsWith("reply without call") },
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
            callMs = analysis.callMs,
            pairedReplies = analysis.pairedReplies,
        )
}

private fun seqOf(e: SequenceEvent, index: Int): Long = (e as? Message)?.seq?.takeIf { it > 0 } ?: (index + 1).toLong()

/** Span from the earliest `startedAt` to the latest start or end, single source only. */
private fun wallClock(
    events: List<SequenceEvent>,
    callMs: Map<String, Double>,
): Double? {
    // A measured call with no start time could sit anywhere, so the span would be a guess.
    val stamped = events.mapNotNullTo(HashSet()) { e -> e.id.takeIf { e.createdAt != null } }
    if (callMs.keys.any { it !in stamped }) return null
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
