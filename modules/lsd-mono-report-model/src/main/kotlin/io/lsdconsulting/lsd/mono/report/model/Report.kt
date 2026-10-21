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
    /** The worst scenario outcome: [StatusJson.ERROR], else `WARN`, else `SUCCESS` (also when there are no scenarios). */
    val status: StatusJson,
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
    /** Width the diagram cuts message labels to; the full label stays in the report and the side panel. */
    val labelMaxWidth: Int = 200,
    /**
     * Whether the page may send the usage ping. The page also needs a release `generator`. True by
     * default, as lsd-mono-core's `lsd.mono.report.usagePing` is; the writer always writes it.
     */
    val usagePing: Boolean = true,
    /** What wrote the report, counted by the usage ping as `source-<name>`: one of [KnownReportSource.ALL], or another name. */
    val source: String = KnownReportSource.API,
)
