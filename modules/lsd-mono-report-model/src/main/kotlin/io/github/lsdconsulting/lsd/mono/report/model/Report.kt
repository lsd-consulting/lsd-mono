package io.github.lsdconsulting.lsd.mono.report.model

/**
 * One report: the document `lsd-report.schema.json` describes, holding the scenarios of a test
 * class, a feature or a `report { }` block. The writer adds `schemaVersion` ([ReportSchema.VERSION]).
 *
 * The classes in this package are plain values with no behaviour and no dependencies, so any
 * producer can build a report from them, with or without lsd-mono-jvm. The ones that grow with the
 * schema, this one included, are made with a builder ([builder]) and changed with [toBuilder]: a
 * newer release adds optional setters, which breaks no caller. The small fixed ones ([FactJson],
 * [MetricJson], [TraceJson], [WarningJson], [PairAccuracyJson]) are data classes.
 */
public class ReportJson internal constructor(
    /** The report's title, shown at the top of the page and in the index. */
    public val title: String,
    /** When the report was written: an RFC 3339 date-time with `Z` or an offset, such as `2026-10-21T08:00:00Z`. */
    public val generatedAt: String,
    /** What wrote the report, and its version when it has one. */
    public val generator: GeneratorJson,
    /** The worst scenario outcome: [StatusJson.ERROR], else `WARN`, else `SUCCESS` (also when there are no scenarios). */
    public val status: StatusJson,
    /** Switches for the page. */
    public val options: ReportOptionsJson,
    /** The scenarios, in the order the page lists them. */
    public val scenarios: List<ScenarioJson>,
) {
    /** A builder holding this report's values, to make a changed copy. */
    public fun toBuilder(): Builder = Builder(title, generatedAt, generator, status).options(options).scenarios(scenarios)

    override fun equals(other: Any?): Boolean = other is ReportJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("ReportJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "title" to title,
            "generatedAt" to generatedAt,
            "generator" to generator,
            "status" to status,
            "options" to options,
            "scenarios" to scenarios,
        )

    /** Makes a [ReportJson]. The options default as [ReportOptionsJson.Builder]'s do; there are no scenarios until added. */
    public class Builder internal constructor(
        private val title: String,
        private val generatedAt: String,
        private val generator: GeneratorJson,
        private val status: StatusJson,
    ) {
        private var options: ReportOptionsJson = ReportOptionsJson.builder().build()
        private val scenarios = mutableListOf<ScenarioJson>()

        public fun options(value: ReportOptionsJson): Builder = apply { options = value }

        /** Adds one scenario, after those added before. */
        public fun scenario(value: ScenarioJson): Builder = apply { scenarios += value }

        /** Replaces the scenarios. */
        public fun scenarios(values: List<ScenarioJson>): Builder = apply { scenarios.replaceWith(values) }

        public fun build(): ReportJson = ReportJson(title, generatedAt, generator, status, options, scenarios.toList())
    }

    public companion object {
        /** A builder for a report with what the schema requires of one. */
        @JvmStatic
        public fun builder(
            title: String,
            generatedAt: String,
            generator: GeneratorJson,
            status: StatusJson,
        ): Builder = Builder(title, generatedAt, generator, status)
    }
}

/** Switches for the report page. */
public class ReportOptionsJson internal constructor(
    /** When false, scenarios carry no `metrics`. */
    public val metricsEnabled: Boolean,
    /** Characters the diagram cuts message labels to; the full label stays in the report and the side panel. */
    public val labelMaxChars: Int,
    /**
     * Whether the page may send the usage ping. The page also needs to be a release build. True by
     * default, as lsd-mono-jvm's `lsd.mono.report.usagePing` is; the writer always writes it. A
     * reader takes a report that does not say as false.
     */
    public val usagePing: Boolean,
    /** What wrote the report, counted by the usage ping as `source-<name>`: one of [KnownReportSource.ALL], or another name. */
    public val source: String,
) {
    /** A builder holding these options, to make a changed copy. */
    public fun toBuilder(): Builder =
        Builder()
            .metricsEnabled(metricsEnabled)
            .labelMaxChars(labelMaxChars)
            .usagePing(usagePing)
            .source(source)

    override fun equals(other: Any?): Boolean = other is ReportOptionsJson && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("ReportOptionsJson", fields())

    private fun fields(): List<Pair<String, Any?>> =
        listOf(
            "metricsEnabled" to metricsEnabled,
            "labelMaxChars" to labelMaxChars,
            "usagePing" to usagePing,
            "source" to source,
        )

    /** Makes [ReportOptionsJson]: metrics on, labels cut at 200, the usage ping on, source [KnownReportSource.API]. */
    public class Builder internal constructor() {
        private var metricsEnabled: Boolean = true
        private var labelMaxChars: Int = 200
        private var usagePing: Boolean = true
        private var source: String = KnownReportSource.API

        public fun metricsEnabled(value: Boolean): Builder = apply { metricsEnabled = value }

        public fun labelMaxChars(value: Int): Builder = apply { labelMaxChars = value }

        public fun usagePing(value: Boolean): Builder = apply { usagePing = value }

        public fun source(value: String): Builder = apply { source = value }

        public fun build(): ReportOptionsJson = ReportOptionsJson(metricsEnabled, labelMaxChars, usagePing, source)
    }

    public companion object {
        /** A builder with every option at its default. */
        @JvmStatic
        public fun builder(): Builder = Builder()
    }
}

/**
 * What wrote a report or index: the producer's [name], such as `lsd-mono-jvm`, and its [version]
 * when it has one, such as `0.7.0`. The page shows "Written by [name]", with the version only when
 * it is not the page's own.
 */
public data class GeneratorJson
    @JvmOverloads
    constructor(
        public val name: String,
        public val version: String? = null,
    ) {
        init {
            require(name.isNotEmpty()) { "A generator's name is not empty" }
            require(version == null || version.isNotEmpty()) { "A generator's version is null, not empty" }
        }
    }
