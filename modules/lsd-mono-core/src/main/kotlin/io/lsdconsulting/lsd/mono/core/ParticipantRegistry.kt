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

/**
 * The participants of an [LsdContext], in declaration order: declared ones and those created
 * the first time an event names them. Not thread-safe; the context guards it with its lock.
 */
internal class ParticipantRegistry {
    private val byId = linkedMapOf<String, Participant>()

    /** Declaring an id again with a different name keeps both, with a numbered id for the second. */
    fun declare(additional: List<Participant>) {
        additional.forEach { incoming ->
            val id =
                if (byId.containsKey(incoming.id) && byId[incoming.id]?.name != incoming.name) {
                    uniqueId(incoming.id)
                } else {
                    incoming.id
                }
            byId[id] = incoming.copy(id = id)
        }
    }

    /** The participant [ref] names, by id, name or display name; created when there is none. */
    fun resolve(ref: String): Participant {
        byId[ref]?.let { return it }
        byId.values.firstOrNull { it.name == ref || it.displayName == ref }?.let { return it }
        val id = uniqueId(ParticipantIds.fromName(ref))
        val created = Participant(name = ref, id = id)
        byId[id] = created
        return created
    }

    /** The participants [events] refer to, in declaration order. */
    fun usedBy(events: List<SequenceEvent>): List<Participant> {
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
        return byId.values.filter { it.id in ids }
    }

    fun clear(): Unit = byId.clear()

    private fun uniqueId(base: String): String {
        if (!byId.containsKey(base)) return base
        var n = 2
        while (byId.containsKey("$base-$n")) n++
        return "$base-$n"
    }
}
