package io.lsdconsulting.lsd.mono.report.model

/**
 * One scenario: its outcome, what it is about, who takes part and what happened, in order.
 *
 * The fields from [accuracy] on are the timing summary, flat on the scenario as the schema has
 * them. lsd-mono-core sets all of them or none; one left null (or empty) is not written, and the
 * page works it out.
 */
@ExperimentalLsdReportModel
public data class ScenarioJson(
    /** Unique within the report; the page's links use it. */
    val id: String,
    val title: String,
    /** The scenario's outcome. */
    val status: StatusJson,
    val description: String,
    /** Key and value pairs shown with the scenario, such as an order id. */
    val facts: List<FactJson>,
    /** Figures about the scenario, such as its message count. Empty when metrics are off. */
    val metrics: List<MetricJson> = emptyList(),
    /** The diagram's participants, left to right. */
    val participants: List<ParticipantJson> = emptyList(),
    /** What happened, in order. */
    val events: List<EventJson> = emptyList(),
    /** Why the scenario failed or was aborted. Null for one that did not. */
    val error: ScenarioErrorJson? = null,
    /** How well the scenario's times are known. */
    val accuracy: AccuracyJson? = null,
    /** The share of messages with a measured duration, 0 to 1. */
    val measuredCoverage: Double? = null,
    /** The share of calls paired with their reply, 0 to 1. */
    val pairingCoverage: Double? = null,
    /** The capture sources the scenario's messages came from, such as `local`. Null is not written; empty is. */
    val sources: List<String>? = null,
    /** From the first message's start to the last one's end. */
    val wallClockMs: Double? = null,
    /** Which events were put in clock order. */
    val clockOrdering: ClockOrderingJson? = null,
    /** How many messages were put in clock order. */
    val clockOrdered: Int? = null,
    /** Timing warnings. Written when there are any. */
    val warnings: List<WarningJson> = emptyList(),
    /** Ids of the messages moved into clock order. Written when there are any. */
    val reorderedByClock: List<String> = emptyList(),
    /** The accuracy between each pair of participants. Written when there are any. */
    val pairAccuracy: List<PairAccuracyJson> = emptyList(),
)

/** Why a scenario failed. */
@ExperimentalLsdReportModel
public data class ScenarioErrorJson(
    /** One line, such as the exception's class. */
    val headline: String,
    val message: String,
    /** The stack trace, when there is one to show. */
    val stack: String? = null,
)

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

/** A participant in the diagram. */
@ExperimentalLsdReportModel
public data class ParticipantJson(
    /** What events name the participant by. */
    val id: String,
    /** The name shown. */
    val name: String,
    /** How it is drawn: one of [KnownParticipantType.ALL], or another, which a reader draws as a participant. */
    val type: String = KnownParticipantType.PARTICIPANT,
    /** A shorter name to show instead, when there is one. */
    val alias: String? = null,
    /** A CSS colour for its lifeline. */
    val colour: String? = null,
)
