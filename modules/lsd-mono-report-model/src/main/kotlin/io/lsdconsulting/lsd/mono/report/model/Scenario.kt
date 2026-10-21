package io.lsdconsulting.lsd.mono.report.model

/** One scenario: its outcome, what it is about, who takes part and what happened, in order. */
@ExperimentalLsdReportModel
public data class ScenarioJson(
    /** Unique within the report; the page's links use it. */
    val id: String,
    val title: String,
    /** `success`, `warn` or `error`. */
    val status: String,
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
    /** How the scenario's times were measured. Null leaves it out, and the page works it out. */
    val timing: ScenarioTimingJson? = null,
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

/**
 * How a scenario's times were measured. The names and values are the schema's: see
 * `lsd-report.schema.json` for each enum.
 */
@ExperimentalLsdReportModel
public data class ScenarioTimingJson(
    /** The schema's `Accuracy`: `STRUCTURE_ONLY`, `TIMESTAMPED`, `MEASURED` or `TRACED`. */
    val accuracy: String,
    /** The share of messages with a measured duration, 0 to 1. */
    val measuredCoverage: Double?,
    /** The share of calls paired with their reply, 0 to 1. */
    val pairingCoverage: Double?,
    /** The capture sources the scenario's messages came from, such as `local`. */
    val sources: List<String>,
    /** From the first message's start to the last one's end. */
    val wallClockMs: Double?,
    /** The schema's `ClockOrdering`: `OFF`, `SAME_SOURCE` or `ALL_SOURCES`. */
    val clockOrdering: String,
    /** How many messages were put in clock order. */
    val clockOrdered: Int,
    val warnings: List<WarningJson>,
    /** Ids of the messages moved into clock order. */
    val reorderedByClock: List<String>,
    /** The accuracy between each pair of participants. */
    val pairAccuracy: List<PairAccuracyJson> = emptyList(),
)

/** A timing warning: its `kind` (for example `LONGER_THAN_PARENT`) and its sentence. */
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
    val accuracy: String,
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
    /** How it is drawn: `PARTICIPANT`, `ACTOR`, `DATABASE`, `QUEUE`, `ENTITY` or `BOUNDARY`. A reader draws another as a participant. */
    val type: String = "PARTICIPANT",
    /** A shorter name to show instead, when there is one. */
    val alias: String? = null,
    /** A CSS colour for its lifeline. */
    val colour: String? = null,
)
