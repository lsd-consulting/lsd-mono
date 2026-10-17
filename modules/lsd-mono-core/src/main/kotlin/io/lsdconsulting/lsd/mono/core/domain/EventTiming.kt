package io.lsdconsulting.lsd.mono.core.domain

import io.lsdconsulting.lsd.mono.core.Accuracy
import io.lsdconsulting.lsd.mono.core.ClockOrdering
import io.lsdconsulting.lsd.mono.core.OrderSource
import io.lsdconsulting.lsd.mono.core.PairingSource
import io.lsdconsulting.lsd.mono.core.TimingSource
import java.time.Duration

/** Per-message timing facts, keyed by event id in [ScenarioTiming.perEvent]. */
internal data class EventTiming(
    val timing: TimingSource,
    /** Calls and replies only. */
    val pairing: PairingSource?,
    val order: OrderSource,
)

/** What a timing warning is about. The report UI labels its pills from [label]. */
internal enum class WarningKind(
    val label: String,
) {
    REPLY_WITHOUT_CALL("reply without call"),
    DURATION_ON_REPLY_DROPPED("duration on reply dropped"),
    LONGER_THAN_PARENT("longer than parent"),
    DUPLICATE_SPAN("duplicate span"),
    SKEW("skew"),
}

/** A timing warning: its [kind] and a sentence about the events involved. */
internal data class TimingWarning(
    val kind: WarningKind,
    val message: String,
) {
    /** `kind: message`, for logs and tests. */
    val text: String get() = "${kind.label}: $message"
}

/** The accuracy of the messages from [from] to [to] (replies count with their call). */
internal data class PairAccuracy(
    val from: String,
    val to: String,
    val accuracy: Accuracy,
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
    val warnings: List<TimingWarning> = emptyList(),
    val reorderedByClock: List<String> = emptyList(),
    val perEvent: Map<String, EventTiming> = emptyMap(),
    /** Each call's duration, its own or its reply's, by call id. The JSON writes it on the call. */
    val callMs: Map<String, Double> = emptyMap(),
    /** Replies paired with a call. Their duration belongs to the call, so the JSON leaves it off them. */
    val pairedReplies: Set<String> = emptySet(),
    /** Accuracy per participant pair, given only when the pairs differ. */
    val pairAccuracy: List<PairAccuracy> = emptyList(),
    /** The call each message runs inside, by event id: span link first, else the innermost open call. Replies are left out. */
    val parentOf: Map<String, String> = emptyMap(),
    /** The call each paired reply answers, by event id. */
    val replyOf: Map<String, String> = emptyMap(),
) {
    /**
     * The duration the report shows for [message]: a call's own or its reply's, none on a paired
     * reply, else the message's own. The JSON and the metrics both use it, so a call counts once.
     */
    fun reportedMs(message: Message): Double? =
        when (message.id) {
            in callMs -> callMs[message.id]
            in pairedReplies -> null
            else -> message.timedMs
        }
}

/**
 * Pairs calls with replies, works out each message's timing and the scenario's accuracy, and
 * orders [captured] (capture order) for the report:
 *
 * 1. Capture order is the base.
 * 2. Under [mode] (default [ClockOrdering.SAME_SOURCE]) events with a `startedAt` and no measured
 *    duration are sorted by `(startedAt, capture order)` among the slots their group occupies, a
 *    group being one parent call and one source (or every source for [ClockOrdering.ALL_SOURCES]).
 *    Untimed events keep their slots. A per-message hint opts in (same source) or out.
 * 3. Structure wins: when clock order would put a reply before its call, a consume before its
 *    publish, or a child outside its parent call, the groups involved keep capture order and a
 *    `skew` warning is added. Under [ClockOrdering.ALL_SOURCES] a group first falls back to
 *    ordering within each source, and a warning names each source pair it now orders apart:
 *    every pair in that group, not only the two whose clocks disagree.
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
    val warnings: List<TimingWarning>,
    val reverted: Boolean,
    /** Replies with no call. */
    val orphans: Int,
    val parentOf: Map<String, String>,
    val replyOf: Map<String, String>,
)

/** Each call's duration: its own, else its reply's. [derived] marks durations computed from timestamps. */
internal class CallDurations(
    val callMs: Array<Double?>,
    val derived: BooleanArray,
    val warnings: List<TimingWarning>,
)

private fun callDurations(
    events: List<SequenceEvent>,
    pairs: Pairs,
): CallDurations {
    val n = events.size
    val warnings = mutableListOf<TimingWarning>()
    val callMs = arrayOfNulls<Double>(n)
    val derived = BooleanArray(n)
    for (i in 0 until n) {
        val m = events[i] as? Message ?: continue
        if (!m.isCall()) continue
        val reply = pairs.replyOf[i].takeIf { it >= 0 }?.let { events[it] as Message }
        val own = m.timedMs
        val theirs = reply?.timedMs
        if (own != null && theirs != null && reply.durationMs != null && m.durationMs != null) {
            warnings += TimingWarning(WarningKind.DURATION_ON_REPLY_DROPPED, "'${m.label}' already has one")
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
            m == null -> if (e.startedAt != null) TimingSource.TIMESTAMPED else TimingSource.NONE
            m.isCall() && durations.callMs[i] != null -> if (durations.derived[i]) TimingSource.DERIVED else TimingSource.MEASURED
            pairs.callOf[i] < 0 && !m.isCall() && m.timedMs != null -> if (m.derived) TimingSource.DERIVED else TimingSource.MEASURED
            m.startedAt != null -> TimingSource.TIMESTAMPED
            else -> TimingSource.NONE
        }
    }

/** Durations closer than this are taken as equal (rounding in the caller's clock). */
private const val LONGER_EPSILON_MS = 0.001

/**
 * A call that took longer than the call it runs inside: the measurements disagree (clocks on
 * different hosts, a duration taken at the wrong point, or a call that outlived its parent).
 */
private fun longerThanParent(
    events: List<SequenceEvent>,
    durations: CallDurations,
    parent: IntArray,
): List<TimingWarning> =
    events.indices.mapNotNull { i ->
        val own = durations.callMs[i] ?: return@mapNotNull null
        val p = parent[i].takeIf { it >= 0 } ?: return@mapNotNull null
        val outer = durations.callMs[p] ?: return@mapNotNull null
        if (own <= outer + LONGER_EPSILON_MS) return@mapNotNull null
        TimingWarning(
            WarningKind.LONGER_THAN_PARENT,
            "'${(events[i] as Message).label}' took ${formatMs(own)} ms, " +
                "more than '${(events[p] as Message).label}' (${formatMs(outer)} ms) that it runs inside",
        )
    }

private fun analyse(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
): Analysis {
    val pairs = pairCalls(events)
    val durations = callDurations(events, pairs)
    val timing = timingSources(events, pairs, durations)
    val parent = parentCalls(events, pairs)
    val clock = clockOrder(events, mode, pairs, durations, parent)
    val order = clock.order
    val undone = clock.undone
    val warnings = pairs.warnings + durations.warnings + longerThanParent(events, durations, parent)
    val skew =
        if (undone > 0) {
            listOf(
                TimingWarning(
                    WarningKind.SKEW,
                    "clock order ignored for $undone events, as it would put a reply before its call, " +
                        "a consume before its publish, or a child outside its parent; capture order kept",
                ),
            )
        } else {
            emptyList()
        } +
            clock.splitPairs.map { (a, b) ->
                TimingWarning(
                    WarningKind.SKEW,
                    "clocks of $a and $b disagree with the structure, so their events are clock-ordered within each source only",
                )
            }
    return Analysis(
        ordered = order.map { events[it] },
        timing = events.indices.associate { events[it].id to timing[it] },
        pairing = events.indices.associate { events[it].id to pairs.pairing[it] },
        callMs = events.indices.mapNotNull { i -> durations.callMs[i]?.let { events[i].id to it } }.toMap(),
        pairedReplies = events.indices.filter { pairs.callOf[it] >= 0 }.mapTo(HashSet()) { events[it].id },
        warnings = warnings + skew,
        reverted = undone > 0,
        orphans = pairs.warnings.count { it.kind == WarningKind.REPLY_WITHOUT_CALL },
        parentOf =
            events.indices
                .filter { events[it] is Message && pairs.callOf[it] < 0 && parent[it] >= 0 }
                .associate { events[it].id to events[parent[it]].id },
        replyOf = events.indices.filter { pairs.callOf[it] >= 0 }.associate { events[it].id to events[pairs.callOf[it]].id },
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
    val strongPairs = calls.count { analysis.strongPair(it) }
    val accuracy = accuracyOf(ordered, analysis)
    val pairAccuracy =
        ordered
            .filterIsInstance<Message>()
            .filter { it.id !in analysis.pairedReplies }
            .groupBy { it.from to it.to }
            .map { (pair, messages) -> PairAccuracy(pair.first.orEmpty(), pair.second.orEmpty(), accuracyOf(messages, analysis)) }
            .takeIf { list -> list.map { it.accuracy }.distinct().size > 1 }
            .orEmpty()
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
            pairAccuracy = pairAccuracy,
            parentOf = analysis.parentOf,
            replyOf = analysis.replyOf,
        )
}

private fun Analysis.strongPair(e: SequenceEvent) = pairing[e.id] == PairingSource.CALL_ID || pairing[e.id] == PairingSource.TRACE

/** TRACED when something is measured and every call is paired by id or trace, then MEASURED, TIMESTAMPED, STRUCTURE_ONLY. */
private fun accuracyOf(
    events: List<SequenceEvent>,
    analysis: Analysis,
): Accuracy {
    val calls = events.filter { it.isCall() }
    val timings = events.map { analysis.timing[it.id] ?: TimingSource.NONE }
    val anyMeasured = timings.any { it == TimingSource.MEASURED }
    return when {
        anyMeasured && calls.isNotEmpty() && calls.all { analysis.strongPair(it) } -> Accuracy.TRACED
        anyMeasured -> Accuracy.MEASURED
        timings.any { it == TimingSource.TIMESTAMPED || it == TimingSource.DERIVED } -> Accuracy.TIMESTAMPED
        else -> Accuracy.STRUCTURE_ONLY
    }
}

private fun seqOf(e: SequenceEvent, index: Int): Long = (e as? Message)?.seq?.takeIf { it > 0 } ?: (index + 1).toLong()

/** Span from the earliest `startedAt` to the latest start or end, single source only. */
private fun wallClock(
    events: List<SequenceEvent>,
    callMs: Map<String, Double>,
): Double? {
    // A measured call with no start time could sit anywhere, so the span would be a guess.
    val stamped = events.mapNotNullTo(HashSet()) { e -> e.id.takeIf { e.startedAt != null } }
    if (callMs.keys.any { it !in stamped }) return null
    val starts = events.mapNotNull { e -> e.startedAt?.let { e.id to it } }
    if (starts.size < 2 && starts.none { callMs[it.first] != null }) return null
    val first = starts.minOfOrNull { it.second } ?: return null
    val last =
        starts.maxOf { (id, at) ->
            val ms = callMs[id] ?: 0.0
            at.plus(Duration.ofNanos((ms * 1_000_000).toLong()))
        }
    return Duration.between(first, last).toNanos() / 1_000_000.0
}
