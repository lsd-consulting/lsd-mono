package io.lsdconsulting.lsd.mono.core.model

/**
 * The report JSON Schema (`modules/lsd-mono-report-schema`) that reports and the index follow.
 * Every report and index writes [VERSION] as `schemaVersion`.
 */
internal object ReportSchema {
    /**
     * Semver, apart from the lsd-mono version: 0.x, and so free to change, until the format is
     * frozen at 1.0.0. Raise it with the schema files' `$id`s; `ReportSchemaTest` fails while
     * they differ.
     */
    const val VERSION: String = "0.1.0"
}
