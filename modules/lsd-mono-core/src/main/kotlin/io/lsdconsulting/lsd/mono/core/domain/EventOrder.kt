package io.lsdconsulting.lsd.mono.core.domain

import java.time.Instant

/**
 * Orders events for layout and JSON.
 *
 * When no event has [SequenceEvent.createdAt], capture order is unchanged.
 * Timed events sort by that instant (stable on ties). Untimed events keep
 * their relative capture order and come after every timed event.
 */
fun orderByCreatedAt(events: List<SequenceEvent>): List<SequenceEvent> {
    if (events.none { it.createdAt != null }) return events
    return events
        .withIndex()
        .sortedWith(
            compareBy<IndexedValue<SequenceEvent>> { it.value.createdAt ?: Instant.MAX }
                .thenBy { it.index },
        ).map { it.value }
}
