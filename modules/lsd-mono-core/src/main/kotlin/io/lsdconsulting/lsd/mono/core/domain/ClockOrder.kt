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
 * Clock-order [slots] like [sortIntoSlots], except that events of two sources named in [apart]
 * keep the interleaving their slots had: the k-th event of a source (by its own clock) takes
 * that source's k-th slot's place relative to the other source's events. Every other pair of
 * sources, and each source within itself, is still ordered by clock.
 */
internal fun sortIntoSlotsApart(
    events: List<SequenceEvent>,
    slots: List<Int>,
    apart: Set<Pair<String, String>>,
    order: IntArray,
) {
    if (apart.isEmpty()) return sortIntoSlots(events, slots, order)
    val byClock = compareBy<Int> { events[it].startedAt }.thenBy { it }
    val sources = slots.groupBy { events[it].source() }
    // Per source: its slots in capture order, and its events in clock order. Event k is anchored at slot k.
    val anchors = sources.mapValues { (_, idx) -> idx.sorted() }
    val queues = sources.mapValues { (_, idx) -> idx.sortedWith(byClock) }
    val next = sources.keys.associateWithTo(HashMap()) { 0 }

    fun apart(a: String, b: String) = (if (a < b) a to b else b to a) in apart

    fun anchor(source: String): Int = anchors.getValue(source)[next.getValue(source)]
    val placed = ArrayList<Int>(slots.size)
    while (placed.size < slots.size) {
        val live = next.filter { (source, k) -> k < queues.getValue(source).size }.keys
        // A source's head may go next unless a source kept apart from it has a head anchored earlier.
        // The head anchored earliest always may, so something is always placed.
        val ready = live.filter { s -> live.none { r -> r != s && apart(s, r) && anchor(r) < anchor(s) } }
        val source = ready.minWith(compareBy(byClock) { s: String -> queues.getValue(s)[next.getValue(s)] })
        placed += queues.getValue(source)[next.getValue(source)]
        next[source] = next.getValue(source) + 1
    }
    slots.sorted().forEachIndexed { k, slot -> order[slot] = placed[k] }
}

/**
 * Clock-order each group (parent call and scope) into its own slots, then undo any group whose
 * moves break structure: a reply before its call, a consume before its publish, or a child
 * outside its parent. Under [ClockOrdering.ALL_SOURCES] a group whose break involves events of
 * two sources first keeps just that pair apart ([sortIntoSlotsApart]) and tries again; a group
 * still broken with no new pair to blame keeps capture order. Returns the order, the number of
 * events in groups that were undone, and the source pairs kept apart.
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
    val groups = (0 until n).filter { groupKeys[it] != null }.groupBy { groupKeys[it]!! }
    val order = IntArray(n) { it }
    groups.values.forEach { sortIntoSlots(events, it, order) }
    val apart = HashMap<String, MutableSet<Pair<String, String>>>()

    val reverted = mutableSetOf<String>()
    while (true) {
        val pos = IntArray(n)
        order.forEachIndexed { p, orig -> pos[orig] = p }
        // Group -> the events of each break it is part of.
        val bad = LinkedHashMap<String, MutableList<List<Int>>>()

        fun flag(vararg idx: Int) {
            val involved = idx.filter { it >= 0 }
            involved.mapNotNullTo(LinkedHashSet()) { groupKeys[it]?.takeIf { g -> g !in reverted } }.forEach {
                bad.getOrPut(it) { mutableListOf() } += involved
            }
        }
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
        for ((g, breaks) in bad) {
            val members = groups.getValue(g)
            val kept = apart.getOrPut(g) { mutableSetOf() }
            val blamed =
                if (g.endsWith("|*")) {
                    breaks
                        .flatMap { involved ->
                            val sources = involved
                                .filter { groupKeys[it] == g }
                                .map { events[it].source() }
                                .distinct()
                                .sorted()
                            sources.indices.flatMap { a -> (a + 1 until sources.size).map { b -> sources[a] to sources[b] } }
                        }.filterTo(LinkedHashSet()) { it !in kept }
                } else {
                    emptySet()
                }
            if (blamed.isEmpty()) {
                members.forEach { order[it] = it }
                reverted += g
            } else {
                kept += blamed
                sortIntoSlotsApart(events, members, kept, order)
            }
        }
    }
    val split = apart.filterKeys { it !in reverted }.values.flatMapTo(sortedSetOf(compareBy({ it.first }, { it.second }))) { it }
    return ClockOrder(order, reverted.sumOf { groups.getValue(it).size }, split)
}

/** The clock order, the events whose groups kept capture order, and the source pairs ordered apart. */
internal class ClockOrder(
    val order: IntArray,
    val undone: Int,
    val splitPairs: Set<Pair<String, String>>,
)
