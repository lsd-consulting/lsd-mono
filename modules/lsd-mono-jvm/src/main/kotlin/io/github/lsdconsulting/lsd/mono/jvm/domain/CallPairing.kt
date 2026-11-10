package io.github.lsdconsulting.lsd.mono.jvm.domain

import io.github.lsdconsulting.lsd.mono.jvm.PairingSource
import io.github.lsdconsulting.lsd.mono.jvm.Timing

internal fun SequenceEvent.isCall() = this is Message && type == MessageType.SYNCHRONOUS

internal fun SequenceEvent.isReply() = this is Message && type == MessageType.SYNCHRONOUS_RESPONSE

internal fun SequenceEvent.source(): String = (this as? Message)?.source ?: Timing.LOCAL

/** Calls paired with replies, by index into the events. */
internal class Pairs(
    /** For a call, the index of its reply, else -1. */
    val replyOf: IntArray,
    /** For a reply, the index of its call, else -1. */
    val callOf: IntArray,
    /** Calls and replies only. */
    val pairing: Array<PairingSource?>,
    /** Call or publish id to the index of the event that carries it. */
    val byCallId: Map<String, Int>,
    val warnings: List<TimingWarning>,
)

/** Pair each reply with a call: by `replyTo`, else by span id, else guessed by direction. */
internal fun pairCalls(events: List<SequenceEvent>): Pairs {
    val n = events.size
    val warnings = mutableListOf<TimingWarning>()
    val replyOf = IntArray(n) { -1 }
    val callOf = IntArray(n) { -1 }
    val pairing = arrayOfNulls<PairingSource>(n)
    val byCallId = HashMap<String, Int>()

    fun unpairedCall(j: Int) = events[j].isCall() && replyOf[j] < 0

    // Unpaired calls by span and by direction, latest last. Paired ones are dropped lazily.
    val bySpan = HashMap<Pair<String, String>, ArrayList<Int>>()
    val byDirection = HashMap<Pair<String?, String?>, ArrayList<Int>>()
    val seenSpan = HashMap<Pair<String, String>, Int>()

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
            indexCall(e, i, events, bySpan, byDirection, seenSpan, warnings)
        }
        e.callRef?.id?.let { byCallId.putIfAbsent(it, i) }
        if (!e.isReply()) continue
        val matched =
            pairByCallId(e, i, byCallId, ::unpairedCall)
                ?: pairByTrace(e, bySpan, ::latest)
                ?: pairByDirection(e, byDirection, ::latest)
        if (matched != null) {
            val (c, how) = matched
            replyOf[c] = i
            callOf[i] = c
            pairing[c] = how
            pairing[i] = how
        } else {
            pairing[i] = PairingSource.NONE
            warnings += TimingWarning(WarningKind.REPLY_WITHOUT_CALL, "'${e.label}' (${e.from} to ${e.to})")
        }
    }
    return Pairs(replyOf, callOf, pairing, byCallId, warnings)
}

/** Remember [e] as an open call, by span and by direction, and warn when its span is already open. */
private fun indexCall(
    e: Message,
    i: Int,
    events: List<SequenceEvent>,
    bySpan: HashMap<Pair<String, String>, ArrayList<Int>>,
    byDirection: HashMap<Pair<String?, String?>, ArrayList<Int>>,
    seenSpan: HashMap<Pair<String, String>, Int>,
    warnings: MutableList<TimingWarning>,
) {
    e.trace?.let { t ->
        t.spanId?.let { span ->
            val same = bySpan.getOrPut(t.traceId to span) { ArrayList() }
            recordDuplicateSpan(events, i, e, span, t.traceId, seenSpan, warnings)
            same.add(i)
        }
    }
    byDirection.getOrPut(e.from to e.to) { ArrayList() }.add(i)
}

private fun recordDuplicateSpan(
    events: List<SequenceEvent>,
    i: Int,
    e: Message,
    span: String,
    traceId: String,
    seenSpan: HashMap<Pair<String, String>, Int>,
    warnings: MutableList<TimingWarning>,
) {
    seenSpan[traceId to span]?.let { first ->
        warnings += TimingWarning(
            WarningKind.DUPLICATE_SPAN,
            "'${(events[first] as Message).label}' and '${e.label}' share span $span " +
                "in trace $traceId; their replies pair with the latest open one",
        )
    } ?: seenSpan.put(traceId to span, i)
}

private fun pairByCallId(
    e: Message,
    i: Int,
    byCallId: Map<String, Int>,
    unpairedCall: (Int) -> Boolean,
): Pair<Int, PairingSource>? {
    val replyId = e.replyTo?.id ?: return null
    val j = byCallId[replyId]
    return if (j != null && j < i && unpairedCall(j)) j to PairingSource.CALL_ID else null
}

private fun pairByTrace(
    e: Message,
    bySpan: Map<Pair<String, String>, ArrayList<Int>>,
    latest: (ArrayList<Int>?, (Message) -> Boolean) -> Int,
): Pair<Int, PairingSource>? {
    val trace = e.trace ?: return null
    val span = trace.spanId ?: return null
    val c = latest(bySpan[trace.traceId to span]) { true }
    return if (c >= 0) c to PairingSource.TRACE else null
}

private fun pairByDirection(
    e: Message,
    byDirection: Map<Pair<String?, String?>, ArrayList<Int>>,
    latest: (ArrayList<Int>?, (Message) -> Boolean) -> Int,
): Pair<Int, PairingSource>? {
    // Guessed pairing is only for replies that named no call; a missed replyTo must not pick a neighbour.
    if (e.replyTo?.id != null) return null
    val trace = e.trace
    val c = latest(byDirection[e.to to e.from]) { m -> trace == null || m.trace == null || m.trace.traceId == trace.traceId }
    return if (c >= 0) c to PairingSource.GUESSED else null
}

/**
 * Parent call of each event: the open paired call whose span is the event's `parentSpanId` (same
 * trace), else the innermost paired call open at its position. A reply shares its call's parent.
 * The span link wins, so concurrent calls captured interleaved still nest under the right call.
 */
internal fun parentCalls(
    events: List<SequenceEvent>,
    pairs: Pairs,
): IntArray {
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
        val t = (events[i] as? Message)?.trace
        val bySpan =
            t?.parentSpanId?.let { ps ->
                open.lastOrNull { j -> (events[j] as Message).trace?.let { it.traceId == t.traceId && it.spanId == ps } == true }
            }
        parent[i] = bySpan ?: open.lastOrNull() ?: -1
        if (pairs.replyOf[i] >= 0) open.add(i)
    }
    return parent
}
