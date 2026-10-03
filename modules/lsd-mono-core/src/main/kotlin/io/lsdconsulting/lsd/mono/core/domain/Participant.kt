package io.lsdconsulting.lsd.mono.core.domain

/**
 * Lifeline on a sequence diagram.
 *
 * [id] is what events reference (`from` / `to` / `over` / `participantId`).
 * It defaults to a slug of [name] so `"Checkout API"` becomes `checkout-api`.
 * Pass an explicit id when you want a short alias (`api`) the way report samples do.
 *
 * Types match the report union. Legacy PlantUML-only types (`CONTROL`, `COLLECTIONS`)
 * are not carried — use [ParticipantType.PARTICIPANT].
 */
data class Participant @JvmOverloads constructor(
    val name: String,
    val id: String = ParticipantIds.fromName(name),
    val type: ParticipantType = ParticipantType.PARTICIPANT,
    val alias: String? = null,
    val colour: String? = null,
)

enum class ParticipantType {
    ACTOR,
    PARTICIPANT,
    DATABASE,
    QUEUE,
    ENTITY,
    BOUNDARY,
    ;

    @JvmOverloads
    fun called(
        name: String,
        id: String = ParticipantIds.fromName(name),
        alias: String? = null,
        colour: String? = null,
    ): Participant = Participant(name = name, id = id, type = this, alias = alias, colour = colour)
}

object ParticipantIds {
    fun fromName(name: String): String =
        name
            .trim()
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .ifBlank { "participant" }
}
