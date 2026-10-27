package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.Delay
import io.github.lsdconsulting.lsd.mono.jvm.domain.Divider
import io.github.lsdconsulting.lsd.mono.jvm.domain.Lifeline
import io.github.lsdconsulting.lsd.mono.jvm.domain.Message
import io.github.lsdconsulting.lsd.mono.jvm.domain.MessageType
import io.github.lsdconsulting.lsd.mono.jvm.domain.Note
import io.github.lsdconsulting.lsd.mono.jvm.domain.Participant
import io.github.lsdconsulting.lsd.mono.jvm.domain.Section
import io.github.lsdconsulting.lsd.mono.jvm.domain.SequenceEvent
import io.github.lsdconsulting.lsd.mono.jvm.domain.Spacer
import java.time.Instant
import java.util.concurrent.atomic.AtomicLong

/**
 * Binds a captured event to its context: gives it an id, a capture sequence number and the time
 * it was captured, and resolves the participant names it refers to.
 */
internal class EventBinder(private val ids: () -> IdGenerator) {
    private val seq = AtomicLong()

    /** Start the capture sequence again, as [LsdContext.clear] does. */
    fun reset() = seq.set(0)

    /** Bind [event], resolving its participant names with [resolve]. */
    fun bind(
        event: SequenceEvent,
        resolve: (String) -> Participant,
    ): SequenceEvent =
        when (event) {
            is Message -> bindMessage(event, resolve)
            is Note ->
                event.copy(
                    id = ids().next(),
                    over = event.over?.takeIf { it.isNotBlank() }?.let { resolve(it).id },
                )
            is Divider -> event.copy(id = ids().next())
            is Section -> event.copy(id = ids().next())
            is Delay -> event.copy(id = ids().next())
            is Spacer -> event.copy(id = ids().next())
            is Lifeline ->
                event.copy(
                    id = ids().next(),
                    participantId = resolve(event.participantId).id,
                )
        }

    private fun bindMessage(
        captured: Message,
        resolve: (String) -> Participant,
    ): Message {
        val id = ids().next()
        captured.callRef?.let { if (it.id == null) it.id = id }
        val event = captured.copy(seq = seq.incrementAndGet(), capturedAt = Instant.now())
        return when (event.type) {
            MessageType.SHORT_INBOUND -> {
                val toRef = event.to?.takeIf { it.isNotBlank() } ?: event.from.orEmpty()
                event.copy(id = id, from = null, to = resolve(toRef).id)
            }
            MessageType.SHORT_OUTBOUND -> {
                val fromRef = event.from?.takeIf { it.isNotBlank() } ?: event.to.orEmpty()
                event.copy(id = id, from = resolve(fromRef).id, to = null)
            }
            else ->
                event.copy(
                    id = id,
                    from = resolve(event.from.orEmpty()).id,
                    to = resolve(event.to.orEmpty()).id,
                )
        }
    }
}
