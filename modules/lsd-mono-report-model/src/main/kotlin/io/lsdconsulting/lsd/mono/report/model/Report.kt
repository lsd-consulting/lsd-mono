package io.lsdconsulting.lsd.mono.report.model

/**
 * One report: the document `lsd-report.schema.json` describes, holding the scenarios of a test
 * class, a feature or a `report { }` block. The writer adds `schemaVersion` ([ReportSchema.VERSION]).
 *
 * The classes in this package are plain values with no behaviour and no dependencies, so any
 * producer can build a report from them, with or without lsd-mono-core.
 */
@ExperimentalLsdReportModel
public data class ReportJson(
    /** The report's title, shown at the top of the page and in the index. */
    val title: String,
    /** When the report was written: an RFC 3339 date-time with `Z` or an offset, such as `2026-10-21T08:00:00Z`. */
    val generatedAt: String,
    /** What wrote the report and its version, such as `lsd-mono-core 0.7.0`. The usage ping reads it. */
    val generator: String,
    /** The worst scenario outcome: `error`, else `warn`, else `success` (also when there are no scenarios). */
    val status: String,
    /** Switches for the page. */
    val options: ReportOptionsJson = ReportOptionsJson(),
    /** The scenarios, in the order the page lists them. */
    val scenarios: List<ScenarioJson>,
)

/** Switches for the report page. */
@ExperimentalLsdReportModel
public data class ReportOptionsJson(
    /** When false, scenarios carry no `metrics`. */
    val metricsEnabled: Boolean = true,
    /** Characters after which the page truncates labels in its summaries. */
    val labelMaxWidth: Int = 200,
    /** Whether the page may send the usage ping. The page also needs a release `generator`. */
    val usagePing: Boolean = true,
    /** What wrote the report, counted by the usage ping as `source-<name>`: one of [ReportSource.ALL], or another name. */
    val source: String = ReportSource.API,
)

/** The report sources lsd-mono knows. The schema allows others; a reader treats them as unknown. */
@ExperimentalLsdReportModel
public object ReportSource {
    /** lsd-mono-junit-jupiter's extension. */
    public const val JUNIT: String = "junit"

    /** lsd-mono-cucumber-8's plugin. */
    public const val CUCUMBER: String = "cucumber"

    /** A report written through the API directly. */
    public const val API: String = "api"

    /** Every known source. */
    public val ALL: List<String> = listOf(JUNIT, CUCUMBER, API)
}
