package io.github.lsdconsulting.lsd.mono.jvm.domain

import io.github.lsdconsulting.lsd.mono.jvm.describe

/**
 * Lifeline on a sequence diagram.
 *
 * [id] is what events reference (`from` / `to` / `over` / `participantId`).
 * It defaults to a slug of [name] so `"Checkout API"` becomes `checkout-api`.
 * Pass an explicit id when you want a short one (`api`) the way report samples do.
 * [displayName] is what the diagram draws instead of [name]; events can reference either.
 *
 * @property name what events usually call it, and what is drawn unless [displayName] is set.
 * @property id what events reference; defaults to a slug of [name].
 * @property type the header shape.
 * @property displayName drawn instead of [name] when set.
 * @property colour the lifeline's colour, any CSS colour; the report picks one when null.
 *
 * Made with [ParticipantType.called]: `ParticipantType.DATABASE.called("Orders")`.
 *
 * Types match the report union. Legacy PlantUML-only types (`CONTROL`, `COLLECTIONS`)
 * are not carried — use [ParticipantType.PARTICIPANT].
 */
public class Participant internal constructor(
    public val name: String,
    public val id: String = ParticipantIds.fromName(name),
    public val type: ParticipantType = ParticipantType.PARTICIPANT,
    public val displayName: String? = null,
    public val colour: String? = null,
) {
    internal fun copy(id: String = this.id): Participant = Participant(name, id, type, displayName, colour)

    override fun equals(other: Any?): Boolean = other is Participant && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("Participant", fields())

    private fun fields(): Map<String, Any?> =
        mapOf("name" to name, "id" to id, "type" to type, "displayName" to displayName, "colour" to colour)
}

/** The shape of a participant's header on the diagram. */
public enum class ParticipantType {
    /** A stick figure: a person or an outside caller. */
    ACTOR,

    /** A plain box: a service or component. The default. */
    PARTICIPANT,

    /** A cylinder: a database or store. */
    DATABASE,

    /** Two stacked slanted bars: a queue or topic. */
    QUEUE,

    /** A circle (UML entity): a domain object. */
    ENTITY,

    /** A circle with a bar on its left (UML boundary): an edge of the system, such as a gateway. */
    BOUNDARY,
    ;

    /** A [Participant] of this type: `ParticipantType.DATABASE.called("Orders")`. */
    @JvmOverloads
    public fun called(
        name: String,
        id: String = ParticipantIds.fromName(name),
        displayName: String? = null,
        colour: String? = null,
    ): Participant = Participant(name = name, id = id, type = this, displayName = displayName, colour = colour)
}

internal object ParticipantIds {
    fun fromName(name: String): String =
        name
            .trim()
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "-")
            .trim('-')
            .ifBlank { "participant" }
}
