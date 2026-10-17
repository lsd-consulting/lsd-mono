package io.lsdconsulting.lsd.mono.core.domain

import io.lsdconsulting.lsd.mono.core.ClockOrdering

/**
 * Whether clock ordering may move [e]: it has a `startedAt`, is not [measured] (a measured call,
 * or the reply of one), is not opted out, and ordering is on or the event opts in.
 */
internal fun clockEligible(
    e: SequenceEvent,
    mode: ClockOrdering,
    measured: Boolean,
): Boolean {
    if (e.startedAt == null || measured) return false
    val hint = (e as? Message)?.orderHint
    if (hint == false) return false
    return mode != ClockOrdering.OFF || hint == true
}

/** The clock domain [e] is compared in: its source, or every source under [ClockOrdering.ALL_SOURCES]. */
internal fun clockScope(
    e: SequenceEvent,
    mode: ClockOrdering,
): String = if (mode == ClockOrdering.ALL_SOURCES && (e as? Message)?.orderHint != true) "*" else e.source()

/** Sort the events at [slots] by `(startedAt, capture position)` back into the same slots of [order]. */
internal fun sortIntoSlots(
    events: List<SequenceEvent>,
    slots: List<Int>,
    order: IntArray,
) {
    val sorted = slots.sortedWith(compareBy<Int> { events[it].startedAt }.thenBy { it })
    slots.forEachIndexed { k, slot -> order[slot] = sorted[k] }
}

/** Every timed, unmeasured event of a scope sorted into that scope's slots, ignoring structure. */
internal fun clockSorted(
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
internal fun linksHold(events: List<SequenceEvent>): Boolean {
    val position = HashMap<String, Int>()
    events.forEachIndexed { i, e -> (e as? Message)?.callRef?.id?.let { position.putIfAbsent(it, i) } }
    return events.withIndex().all { (i, e) ->
        val m = e as? Message ?: return@all true
        listOfNotNull(m.replyTo?.id, m.causedBy?.id).all { id -> (position[id] ?: -1) < i }
    }
}

/**
 * Clock-order each group (parent call and scope) into its own slots, then undo any group whose
 * moves break structure: a reply before its call, a consume before its publish, or a child
 * outside its parent. Returns the order and the number of events in groups that were undone.
 */
internal fun clockOrder(
    events: List<SequenceEvent>,
    mode: ClockOrdering,
    pairs: Pairs,
    durations: CallDurations,
    parent: IntArray,
): ClockOrder {
    val n = events.size

    fun groupOf(i: Int): String? {
        val call = if (events[i].isCall()) i else pairs.callOf[i]
        val measured = call >= 0 && durations.callMs[call] != null
        if (!clockEligible(events[i], mode, measured)) return null
        return "${parent[i]}|${clockScope(events[i], mode)}"
    }
    val groupKeys = Array(n) { groupOf(it) }
    val groups = (0 until n).filter { groupKeys[it] != null }.groupBy { groupKeys[it]!! }.toMutableMap()
    val order = IntArray(n) { it }
    groups.values.forEach { sortIntoSlots(events, it, order) }
    val split = mutableSetOf<Pair<String, String>>()

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
        for (g in bad) {
            val members = groups[g] ?: continue
            members.forEach { order[it] = it }
            if (!g.endsWith("|*")) {
                reverted += g
                continue
            }
            // ALL_SOURCES: the sources disagree, so fall back to ordering within each source.
            groups.remove(g)
            val bySource = members.groupBy { events[it].source() }
            bySource.forEach { (source, idx) ->
                val key = g.removeSuffix("*") + source
                idx.forEach { groupKeys[it] = key }
                groups[key] = idx
                sortIntoSlots(events, idx, order)
            }
            val names = bySource.keys.sorted()
            for (a in names.indices) for (b in a + 1 until names.size) split += names[a] to names[b]
        }
        rounds = maxOf(rounds, groups.size + 1 - reverted.size)
    }
    return ClockOrder(order, reverted.sumOf { groups[it]?.size ?: 0 }, split)
}

/** The clock order, the events whose groups kept capture order, and the source pairs ordered apart. */
internal class ClockOrder(
    val order: IntArray,
    val undone: Int,
    val splitPairs: Set<Pair<String, String>>,
)
