package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Delay
import io.lsdconsulting.lsd.mono.core.domain.Divider
import io.lsdconsulting.lsd.mono.core.domain.Lifeline
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.Note
import io.lsdconsulting.lsd.mono.core.domain.Participant
import io.lsdconsulting.lsd.mono.core.domain.ParticipantIds
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.domain.Spacer
import java.util.concurrent.atomic.AtomicLong

/**
 * Participants in declaration order: declared ones and those created the first time an event
 * names them. The context has one for declarations made outside any scenario, which every
 * scenario sees, and each scenario has its own, consulted first, so one scenario's
 * declarations never reach another (#61). [order] is shared by a context's registries, so
 * participants from both keep the order they were registered in.
 * Not thread-safe; the context guards it with its lock.
 */
internal class ParticipantRegistry(private val order: AtomicLong) {
    private class Entry(val participant: Participant, val order: Long)

    private val byId = linkedMapOf<String, Entry>()

    /** Declaring an id again with a different name keeps both, with a numbered id for the second. */
    fun declare(additional: List<Participant>) {
        additional.forEach { incoming ->
            val existing = byId[incoming.id]
            val id = if (existing != null && existing.participant.name != incoming.name) uniqueId(incoming.id, null) else incoming.id
            byId[id] = Entry(incoming.copy(id = id), byId[id]?.order ?: order.incrementAndGet())
        }
    }

    /**
     * The participant [ref] names, by id, name or display name: one of these first, then one of
     * [shared]. When neither has it, it is created here, with an id neither uses.
     */
    fun resolve(
        ref: String,
        shared: ParticipantRegistry? = null,
    ): Participant {
        find(ref)?.let { return it }
        shared?.find(ref)?.let { return it }
        val id = uniqueId(ParticipantIds.fromName(ref), shared)
        val created = Participant(name = ref, id = id)
        byId[id] = Entry(created, order.incrementAndGet())
        return created
    }

    /**
     * The participants [events] refer to, from here and from [shared], in the order they were
     * registered. An id declared here hides the same id in [shared].
     */
    fun usedBy(
        events: List<SequenceEvent>,
        shared: ParticipantRegistry? = null,
    ): List<Participant> {
        val ids = linkedSetOf<String>()
        events.forEach { event ->
            when (event) {
                is Message -> {
                    event.from?.takeIf { it.isNotBlank() }?.let(ids::add)
                    event.to?.takeIf { it.isNotBlank() }?.let(ids::add)
                }
                is Note -> event.over?.let { ids.add(it) }
                is Lifeline -> ids.add(event.participantId)
                is Divider, is Section, is Delay, is Spacer -> Unit
            }
        }
        val inherited = shared
            ?.byId
            ?.filterKeys { it !in byId }
            ?.values
            .orEmpty()
        return (byId.values + inherited)
            .filter { it.participant.id in ids }
            .sortedBy { it.order }
            .map { it.participant }
    }

    fun clear(): Unit = byId.clear()

    private fun find(ref: String): Participant? =
        byId[ref]?.participant
            ?: byId.values.firstOrNull { it.participant.name == ref || it.participant.displayName == ref }?.participant

    private fun uniqueId(
        base: String,
        shared: ParticipantRegistry?,
    ): String {
        fun taken(id: String) = byId.containsKey(id) || shared?.byId?.containsKey(id) == true
        if (!taken(base)) return base
        var n = 2
        while (taken("$base-$n")) n++
        return "$base-$n"
    }
}
