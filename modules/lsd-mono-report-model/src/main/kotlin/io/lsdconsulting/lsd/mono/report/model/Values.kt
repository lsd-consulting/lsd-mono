package io.lsdconsulting.lsd.mono.report.model

/*
 * The schema's enum-like values. One rule for all of them:
 * - Where the schema is closed (an `enum`), the model has a Kotlin enum, whose `json` is the
 *   value written. A newer schema minor cannot add to these.
 * - Where the schema is open (`anyOf` its `Known*` list or any string), the model takes a String,
 *   and a `Known*` object names the values lsd-mono knows. A reader treats any other as unknown.
 */

/** The schema's `Status`, closed: a scenario's or a report's outcome. */
@ExperimentalLsdReportModel
public enum class StatusJson(
    /** The value written. */
    public val json: String,
) {
    SUCCESS("success"),
    WARN("warn"),
    ERROR("error"),
}

/** The schema's `NotePlacement`, closed: where a note goes. */
@ExperimentalLsdReportModel
public enum class NotePlacementJson(
    /** The value written. */
    public val json: String,
) {
    /** Over its participant ([NoteEventJson.over]). */
    OVER("over"),
    LEFT("left"),
    RIGHT("right"),
}

/** The schema's `Accuracy`, closed: how well a scenario's (or a pair's) times are known. */
@ExperimentalLsdReportModel
public enum class AccuracyJson(
    /** The value written. */
    public val json: String,
) {
    STRUCTURE_ONLY("STRUCTURE_ONLY"),
    TIMESTAMPED("TIMESTAMPED"),
    MEASURED("MEASURED"),
    TRACED("TRACED"),
}

/** The schema's `ClockOrdering`, closed: which events were put in clock order. */
@ExperimentalLsdReportModel
public enum class ClockOrderingJson(
    /** The value written. */
    public val json: String,
) {
    OFF("OFF"),
    SAME_SOURCE("SAME_SOURCE"),
    ALL_SOURCES("ALL_SOURCES"),
}

/** The lifeline event's `kind`, closed in the schema. */
@ExperimentalLsdReportModel
public enum class LifelineKindJson(
    /** The value written. */
    public val json: String,
) {
    ACTIVATE("activate"),
    DEACTIVATE("deactivate"),
}

/** The schema's `KnownParticipantType`: the [ParticipantJson.type]s lsd-mono knows. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownParticipantType {
    public const val PARTICIPANT: String = "PARTICIPANT"
    public const val ACTOR: String = "ACTOR"
    public const val DATABASE: String = "DATABASE"
    public const val QUEUE: String = "QUEUE"
    public const val ENTITY: String = "ENTITY"
    public const val BOUNDARY: String = "BOUNDARY"

    /** Every known type. */
    public val ALL: List<String> = listOf(ACTOR, PARTICIPANT, DATABASE, QUEUE, ENTITY, BOUNDARY)
}

/** The schema's `KnownMessageType`: the [MessageEventJson.type]s lsd-mono knows. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownMessageType {
    public const val SYNCHRONOUS: String = "SYNCHRONOUS"
    public const val SYNCHRONOUS_RESPONSE: String = "SYNCHRONOUS_RESPONSE"
    public const val ASYNCHRONOUS: String = "ASYNCHRONOUS"
    public const val LOST: String = "LOST"
    public const val BI_DIRECTIONAL: String = "BI_DIRECTIONAL"
    public const val SHORT_INBOUND: String = "SHORT_INBOUND"
    public const val SHORT_OUTBOUND: String = "SHORT_OUTBOUND"

    /** Every known type. */
    public val ALL: List<String> =
        listOf(SYNCHRONOUS, SYNCHRONOUS_RESPONSE, ASYNCHRONOUS, LOST, BI_DIRECTIONAL, SHORT_INBOUND, SHORT_OUTBOUND)
}

/** The schema's `KnownTimingSource`: how a [MessageEventJson.durationMs] was found. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownTimingSource {
    public const val NONE: String = "NONE"
    public const val TIMESTAMPED: String = "TIMESTAMPED"
    public const val MEASURED: String = "MEASURED"
    public const val DERIVED: String = "DERIVED"

    /** Every known source. */
    public val ALL: List<String> = listOf(NONE, TIMESTAMPED, MEASURED, DERIVED)
}

/** The schema's `KnownPairingSource`: how a call and its reply were paired. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownPairingSource {
    public const val NONE: String = "NONE"
    public const val GUESSED: String = "GUESSED"
    public const val CALL_ID: String = "CALL_ID"
    public const val TRACE: String = "TRACE"

    /** Every known source. */
    public val ALL: List<String> = listOf(NONE, GUESSED, CALL_ID, TRACE)
}

/** The schema's `KnownOrderSource`: what put a message in its place. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownOrderSource {
    public const val SEQUENCE: String = "SEQUENCE"
    public const val STRUCTURE: String = "STRUCTURE"
    public const val CLOCK: String = "CLOCK"

    /** Every known source. */
    public val ALL: List<String> = listOf(SEQUENCE, STRUCTURE, CLOCK)
}

/** The schema's `KnownWarningKind`: the [WarningJson.kind]s lsd-mono knows. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownWarningKind {
    public const val REPLY_WITHOUT_CALL: String = "REPLY_WITHOUT_CALL"
    public const val DURATION_ON_REPLY_DROPPED: String = "DURATION_ON_REPLY_DROPPED"
    public const val LONGER_THAN_PARENT: String = "LONGER_THAN_PARENT"
    public const val DUPLICATE_SPAN: String = "DUPLICATE_SPAN"
    public const val SKEW: String = "SKEW"

    /** Every known kind. */
    public val ALL: List<String> = listOf(REPLY_WITHOUT_CALL, DURATION_ON_REPLY_DROPPED, LONGER_THAN_PARENT, DUPLICATE_SPAN, SKEW)
}

/** The schema's `KnownReportSource`: the [ReportOptionsJson.source]s lsd-mono knows. The schema allows others. */
@ExperimentalLsdReportModel
public object KnownReportSource {
    /** lsd-mono-junit-jupiter's extension. */
    public const val JUNIT: String = "junit"

    /** lsd-mono-cucumber-8's plugin. */
    public const val CUCUMBER: String = "cucumber"

    /** A report written through the API directly. */
    public const val API: String = "api"

    /** Every known source. */
    public val ALL: List<String> = listOf(JUNIT, CUCUMBER, API)
}
