package io.lsdconsulting.lsd.mono.report.model

/**
 * The report JSON Schema (`modules/lsd-mono-report-schema`) that reports and the index follow.
 * Every report and index is written with [VERSION] as its `schemaVersion`.
 */
@ExperimentalLsdReportModel
public object ReportSchema {
    /**
     * Semver, apart from the lsd-mono version: 0.x, and so free to change, until the format is
     * frozen at 1.0.0. While it is 0.x a minor version only adds. Raise it with the schema files'
     * `$id`s; lsd-mono-core's `ReportSchemaTest` fails while they differ.
     *
     * A field, not a `const`: a `const` is copied into the code that reads it when that code is
     * compiled, so an adapter would keep its compile-time version after a runtime upgrade.
     */
    @JvmField
    public val VERSION: String = "0.1.0"
}
