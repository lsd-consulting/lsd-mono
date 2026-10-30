package io.github.lsdconsulting.lsd.mono.report.model

/*
 * The schema's enum-like values. Every value written is lower snake case (`synchronous_response`,
 * `structure_only`), whether the enum is closed or open; the Kotlin names stay upper case. One rule
 * for which is which:
 * - Where the schema is closed (an `enum`), the model has a Kotlin enum, whose `json` is the
 *   value written. A newer schema minor cannot add to these.
 * - Where the schema is open (`anyOf` its `Known*` list or any string), the model takes a String,
 *   and a `Known*` object names the values lsd-mono knows. A reader treats any other as unknown.
 */

/**
 * The schema's `Status`, closed: a scenario's or a report's outcome. A report's is the worst of its
 * scenarios', in the order [ERROR], [WARN], [ABORTED], [SUCCESS], [SKIPPED]: a report of only
 * skipped scenarios is skipped, and one with none is [SUCCESS].
 */
public enum class StatusJson(
    /** The value written. */
    public val json: String,
) {
    SUCCESS("success"),

    /** Ran, but not cleanly: a pending, undefined or ambiguous Cucumber step, or a scenario left open. */
    WARN("warn"),
    ERROR("error"),

    /** Not run: a disabled test, or a skipped Cucumber scenario. */
    SKIPPED("skipped"),

    /** Started, then stopped before it finished, such as by a failed assumption. Not a failure. */
    ABORTED("aborted"),
}

/** The schema's `NotePlacement`, closed: where a note goes. */
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
public enum class AccuracyJson(
    /** The value written. */
    public val json: String,
) {
    STRUCTURE_ONLY("structure_only"),
    TIMESTAMPED("timestamped"),
    MEASURED("measured"),
    TRACED("traced"),
}

/** The schema's `ClockOrdering`, closed: which events were put in clock order. */
public enum class ClockOrderingJson(
    /** The value written. */
    public val json: String,
) {
    OFF("off"),
    SAME_SOURCE("same_source"),
    ALL_SOURCES("all_sources"),
}

/** The lifeline event's `kind`, closed in the schema. */
public enum class LifelineKindJson(
    /** The value written. */
    public val json: String,
) {
    ACTIVATE("activate"),
    DEACTIVATE("deactivate"),
}

/** The schema's `KnownParticipantType`: the [ParticipantJson.type]s lsd-mono knows. The schema allows others. */
public object KnownParticipantType {
    public const val PARTICIPANT: String = "participant"
    public const val ACTOR: String = "actor"
    public const val DATABASE: String = "database"
    public const val QUEUE: String = "queue"
    public const val ENTITY: String = "entity"
    public const val BOUNDARY: String = "boundary"

    /** Every known type. */
    @JvmField
    public val ALL: List<String> = listOf(ACTOR, PARTICIPANT, DATABASE, QUEUE, ENTITY, BOUNDARY)
}

/** The schema's `KnownMessageType`: the [MessageEventJson.type]s lsd-mono knows. The schema allows others. */
public object KnownMessageType {
    public const val SYNCHRONOUS: String = "synchronous"
    public const val SYNCHRONOUS_RESPONSE: String = "synchronous_response"
    public const val ASYNCHRONOUS: String = "asynchronous"
    public const val LOST: String = "lost"
    public const val BI_DIRECTIONAL: String = "bi_directional"
    public const val SHORT_INBOUND: String = "short_inbound"
    public const val SHORT_OUTBOUND: String = "short_outbound"

    /** Every known type. */
    @JvmField
    public val ALL: List<String> =
        listOf(SYNCHRONOUS, SYNCHRONOUS_RESPONSE, ASYNCHRONOUS, LOST, BI_DIRECTIONAL, SHORT_INBOUND, SHORT_OUTBOUND)
}

/** The schema's `KnownTimingSource`: how a [MessageEventJson.durationMs] was found. The schema allows others. */
public object KnownTimingSource {
    public const val NONE: String = "none"
    public const val TIMESTAMPED: String = "timestamped"
    public const val MEASURED: String = "measured"
    public const val DERIVED: String = "derived"

    /** Every known source. */
    @JvmField
    public val ALL: List<String> = listOf(NONE, TIMESTAMPED, MEASURED, DERIVED)
}

/** The schema's `KnownPairingSource`: how a call and its reply were paired. The schema allows others. */
public object KnownPairingSource {
    public const val NONE: String = "none"
    public const val GUESSED: String = "guessed"
    public const val CALL_ID: String = "call_id"
    public const val TRACE: String = "trace"

    /** Every known source. */
    @JvmField
    public val ALL: List<String> = listOf(NONE, GUESSED, CALL_ID, TRACE)
}

/** The schema's `KnownOrderSource`: what put a message in its place. The schema allows others. */
public object KnownOrderSource {
    public const val SEQUENCE: String = "sequence"
    public const val STRUCTURE: String = "structure"
    public const val CLOCK: String = "clock"

    /** Every known source. */
    @JvmField
    public val ALL: List<String> = listOf(SEQUENCE, STRUCTURE, CLOCK)
}

/** The schema's `KnownWarningKind`: the [WarningJson.kind]s lsd-mono knows. The schema allows others. */
public object KnownWarningKind {
    public const val REPLY_WITHOUT_CALL: String = "reply_without_call"
    public const val DURATION_ON_REPLY_DROPPED: String = "duration_on_reply_dropped"
    public const val LONGER_THAN_PARENT: String = "longer_than_parent"
    public const val DUPLICATE_SPAN: String = "duplicate_span"
    public const val SKEW: String = "skew"

    /** Every known kind. */
    @JvmField
    public val ALL: List<String> = listOf(REPLY_WITHOUT_CALL, DURATION_ON_REPLY_DROPPED, LONGER_THAN_PARENT, DUPLICATE_SPAN, SKEW)
}

/** The schema's `KnownMessageOrigin`: where a [MessageEventJson] came from. The schema allows others. */
public object KnownMessageOrigin {
    /** Recorded by the producer while the test ran, as lsd-mono-jvm does. A message with no origin is one. */
    public const val CAPTURED: String = "captured"

    /** Built afterwards from another record, such as OpenTelemetry spans. */
    public const val IMPORTED: String = "imported"

    /** Every known origin. */
    @JvmField
    public val ALL: List<String> = listOf(CAPTURED, IMPORTED)
}

/** The schema's `KnownReportSource`: the [ReportOptionsJson.source]s lsd-mono knows. The schema allows others. */
public object KnownReportSource {
    /** lsd-mono-junit-jupiter's extension. */
    public const val JUNIT: String = "junit"

    /** lsd-mono-cucumber-8's plugin. */
    public const val CUCUMBER: String = "cucumber"

    /** A report written through the API directly. */
    public const val API: String = "api"

    /** Every known source. */
    @JvmField
    public val ALL: List<String> = listOf(JUNIT, CUCUMBER, API)
}
