package io.github.lsdconsulting.lsd.mono.report.model

/**
 * One scenario: its outcome, what it is about, who takes part and what happened, in order. Made
 * with [builder].
 *
 * The fields from [accuracy] on are the timing summary, flat on the scenario as the schema has
 * them. lsd-mono-jvm sets all of them or none; one left null (or empty) is not written, and the
 * page works it out.
 */
@ExperimentalLsdReportModel
public class ScenarioJson internal constructor(
    /** Unique within the report; the page's links use it. */
    public val id: String,
    public val title: String,
    /** The scenario's outcome. */
    public val status: StatusJson,
    public val description: String,
    /** Key and value pairs shown with the scenario, such as an order id. */
    public val facts: List<FactJson>,
    /** Figures about the scenario, such as its message count. Empty when metrics are off. */
    public val metrics: List<MetricJson>,
    /** The diagram's participants, left to right. */
    public val participants: List<ParticipantJson>,
    /** What happened, in order. */
    public val events: List<EventJson>,
    /** Why the scenario failed or was aborted. Null for one that did not. */
    public val error: ScenarioErrorJson?,
    /** How well the scenario's times are known. */
    public val accuracy: AccuracyJson?,
    /** The share of messages with a measured duration, 0 to 1. */
    public val measuredCoverage: Double?,
    /** The share of calls paired with their reply, 0 to 1. */
    public val pairingCoverage: Double?,
    /** The capture sources the scenario's messages came from, such as `local`. Null is not written; empty is. */
    public val sources: List<String>?,
    /** From the first message's start to the last one's end. */
    public val wallClockMs: Double?,
    /** Which events were put in clock order. */
    public val clockOrdering: ClockOrderingJson?,
    /** How many messages were put in clock order. */
    public val clockOrdered: Int?,
    /** Timing warnings. Written when there are any. */
    public val warnings: List<WarningJson>,
    /** Ids of the messages moved into clock order. Written when there are any. */
    public val reorderedByClock: List<String>,
    /** The accuracy between each pair of participants. Written when there are any. */
    public val pairAccuracy: List<PairAccuracyJson>,
) {
    /** A builder holding this scenario's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id, title, status)
            .description(description)
            .facts(facts)
            .metrics(metrics)
            .participants(participants)
            .events(events)
            .error(error)
            .accuracy(accuracy)
            .measuredCoverage(measuredCoverage)
            .pairingCoverage(pairingCoverage)
            .sources(sources)
            .wallClockMs(wallClockMs)
            .clockOrdering(clockOrdering)
            .clockOrdered(clockOrdered)
            .warnings(warnings)
            .reorderedByClock(reorderedByClock)
            .pairAccuracy(pairAccuracy)

    override fun equals(other: Any?): Boolean = other is ScenarioJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("ScenarioJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "title" to title,
            "status" to status,
            "description" to description,
            "facts" to facts,
            "metrics" to metrics,
            "participants" to participants,
            "events" to events,
            "error" to error,
            "accuracy" to accuracy,
            "measuredCoverage" to measuredCoverage,
            "pairingCoverage" to pairingCoverage,
            "sources" to sources,
            "wallClockMs" to wallClockMs,
            "clockOrdering" to clockOrdering,
            "clockOrdered" to clockOrdered,
            "warnings" to warnings,
            "reorderedByClock" to reorderedByClock,
            "pairAccuracy" to pairAccuracy,
        )

    /**
     * Makes a [ScenarioJson]. The description is empty and the lists are empty until set; the
     * timing summary is null (not written) until set.
     */
    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
        private val title: String,
        private val status: StatusJson,
    ) {
        private var description: String = ""
        private val facts = mutableListOf<FactJson>()
        private val metrics = mutableListOf<MetricJson>()
        private val participants = mutableListOf<ParticipantJson>()
        private val events = mutableListOf<EventJson>()
        private var error: ScenarioErrorJson? = null
        private var accuracy: AccuracyJson? = null
        private var measuredCoverage: Double? = null
        private var pairingCoverage: Double? = null
        private var sources: List<String>? = null
        private var wallClockMs: Double? = null
        private var clockOrdering: ClockOrderingJson? = null
        private var clockOrdered: Int? = null
        private val warnings = mutableListOf<WarningJson>()
        private val reorderedByClock = mutableListOf<String>()
        private val pairAccuracy = mutableListOf<PairAccuracyJson>()

        public fun description(value: String): Builder = apply { description = value }

        /** Adds one fact, after those added before. */
        public fun fact(
            key: String,
            value: String,
        ): Builder = apply { facts += FactJson(key, value) }

        public fun facts(values: List<FactJson>): Builder = apply { facts.replaceWith(values) }

        /** Adds one metric, after those added before. */
        public fun metric(
            key: String,
            value: String,
        ): Builder = apply { metrics += MetricJson(key, value) }

        public fun metrics(values: List<MetricJson>): Builder = apply { metrics.replaceWith(values) }

        /** Adds one participant, right of those added before. */
        public fun participant(value: ParticipantJson): Builder = apply { participants += value }

        public fun participants(values: List<ParticipantJson>): Builder = apply { participants.replaceWith(values) }

        /** Adds one event, after those added before. */
        public fun event(value: EventJson): Builder = apply { events += value }

        public fun events(values: List<EventJson>): Builder = apply { events.replaceWith(values) }

        public fun error(value: ScenarioErrorJson?): Builder = apply { error = value }

        public fun accuracy(value: AccuracyJson?): Builder = apply { accuracy = value }

        public fun measuredCoverage(value: Double?): Builder = apply { measuredCoverage = value }

        public fun pairingCoverage(value: Double?): Builder = apply { pairingCoverage = value }

        public fun sources(values: List<String>?): Builder = apply { sources = values?.toList() }

        public fun wallClockMs(value: Double?): Builder = apply { wallClockMs = value }

        public fun clockOrdering(value: ClockOrderingJson?): Builder = apply { clockOrdering = value }

        public fun clockOrdered(value: Int?): Builder = apply { clockOrdered = value }

        /** Adds one timing warning, after those added before. */
        public fun warning(value: WarningJson): Builder = apply { warnings += value }

        public fun warnings(values: List<WarningJson>): Builder = apply { warnings.replaceWith(values) }

        public fun reorderedByClock(values: List<String>): Builder = apply { reorderedByClock.replaceWith(values) }

        public fun pairAccuracy(values: List<PairAccuracyJson>): Builder = apply { pairAccuracy.replaceWith(values) }

        public fun build(): ScenarioJson =
            ScenarioJson(
                id = id,
                title = title,
                status = status,
                description = description,
                facts = facts.toList(),
                metrics = metrics.toList(),
                participants = participants.toList(),
                events = events.toList(),
                error = error,
                accuracy = accuracy,
                measuredCoverage = measuredCoverage,
                pairingCoverage = pairingCoverage,
                sources = sources,
                wallClockMs = wallClockMs,
                clockOrdering = clockOrdering,
                clockOrdered = clockOrdered,
                warnings = warnings.toList(),
                reorderedByClock = reorderedByClock.toList(),
                pairAccuracy = pairAccuracy.toList(),
            )
    }

    public companion object {
        /** A builder for a scenario with what the schema requires of one. */
        @JvmStatic
        public fun builder(
            id: String,
            title: String,
            status: StatusJson,
        ): Builder = Builder(id, title, status)
    }
}

/** Why a scenario failed. Made with [builder]. */
@ExperimentalLsdReportModel
public class ScenarioErrorJson internal constructor(
    /** One line, such as the exception's class. */
    public val headline: String,
    public val message: String,
    /** The stack trace, when there is one to show. */
    public val stack: String?,
) {
    /** A builder holding this error's values, to make a changed copy. */
    public fun toBuilder(): Builder = Builder(headline, message).stack(stack)

    override fun equals(other: Any?): Boolean = other is ScenarioErrorJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("ScenarioErrorJson", fields())

    private fun fields(): List<Pair<String, Any?>> = listOf("headline" to headline, "message" to message, "stack" to stack)

    /** Makes a [ScenarioErrorJson], with no stack until set. */
    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val headline: String,
        private val message: String,
    ) {
        private var stack: String? = null

        public fun stack(value: String?): Builder = apply { stack = value }

        public fun build(): ScenarioErrorJson = ScenarioErrorJson(headline, message, stack)
    }

    public companion object {
        @JvmStatic
        public fun builder(
            headline: String,
            message: String,
        ): Builder = Builder(headline, message)
    }
}

/** A timing warning: its `kind` (one of [KnownWarningKind.ALL], or another) and its sentence. */
@ExperimentalLsdReportModel
public data class WarningJson(
    val kind: String,
    val message: String,
)

/** The accuracy of the messages between two participants. */
@ExperimentalLsdReportModel
public data class PairAccuracyJson(
    val from: String,
    val to: String,
    val accuracy: AccuracyJson,
)

/** A fact shown with a scenario. */
@ExperimentalLsdReportModel
public data class FactJson(
    val key: String,
    val value: String,
)

/** A figure shown with a scenario. */
@ExperimentalLsdReportModel
public data class MetricJson(
    val key: String,
    val value: String,
)

/** A participant in the diagram. Made with [builder]. */
@ExperimentalLsdReportModel
public class ParticipantJson internal constructor(
    /** What events name the participant by. */
    public val id: String,
    /** The name shown. */
    public val name: String,
    /** How it is drawn: one of [KnownParticipantType.ALL], or another, which a reader draws as a participant. */
    public val type: String,
    /** A shorter name to show instead, when there is one. */
    public val alias: String?,
    /** A CSS colour for its lifeline. */
    public val colour: String?,
    /**
     * Facts about the participant by OpenTelemetry semantic convention name, such as `service.name`,
     * `service.version` or `peer.service`. Keys are not empty; `lsd.` keys are kept for lsd-mono's
     * own. Written when there are any.
     */
    public val attributes: Map<String, AttributeValueJson>,
) {
    /** A builder holding this participant's values, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder(id, name)
            .type(type)
            .alias(alias)
            .colour(colour)
            .attributes(attributes)

    override fun equals(other: Any?): Boolean = other is ParticipantJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("ParticipantJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "id" to id,
            "name" to name,
            "type" to type,
            "alias" to alias,
            "colour" to colour,
            "attributes" to attributes,
        )

    /** Makes a [ParticipantJson]: a [KnownParticipantType.PARTICIPANT] with no alias, colour or attributes until set. */
    @ExperimentalLsdReportModel
    public class Builder internal constructor(
        private val id: String,
        private val name: String,
    ) {
        private var type: String = KnownParticipantType.PARTICIPANT
        private var alias: String? = null
        private var colour: String? = null
        private val attributes = linkedMapOf<String, AttributeValueJson>()

        public fun type(value: String): Builder = apply { type = value }

        public fun alias(value: String?): Builder = apply { alias = value }

        public fun colour(value: String?): Builder = apply { colour = value }

        /** Sets one attribute, replacing any with the same [key]. The key is not empty. */
        public fun attribute(
            key: String,
            value: AttributeValueJson,
        ): Builder =
            apply {
                requireAttributeKey(key)
                attributes[key] = value
            }

        public fun attribute(
            key: String,
            value: String,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        public fun attribute(
            key: String,
            value: Boolean,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        public fun attribute(
            key: String,
            value: Long,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        public fun attribute(
            key: String,
            value: Int,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        /** A finite number: JSON has no NaN or infinity. */
        public fun attribute(
            key: String,
            value: Double,
        ): Builder = attribute(key, AttributeValueJson.of(value))

        /** Replaces the attributes. No key is empty. */
        public fun attributes(values: Map<String, AttributeValueJson>): Builder =
            apply {
                values.keys.forEach(::requireAttributeKey)
                attributes.clear()
                attributes.putAll(values)
            }

        public fun build(): ParticipantJson = ParticipantJson(id, name, type, alias, colour, attributes.toMap())
    }

    public companion object {
        @JvmStatic
        public fun builder(
            id: String,
            name: String,
        ): Builder = Builder(id, name)
    }
}

internal fun <T> MutableList<T>.replaceWith(values: List<T>) {
    clear()
    addAll(values)
}
