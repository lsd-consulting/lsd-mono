package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties

/**
 * Greenfield report switches. Not a port of PlantUML [com.lsd.core.ReportOptions]:
 * no diagram theme and no `maxEventsPerDiagram` split.
 *
 * [metricsEnabled] defaults **on** (`lsd.mono.metrics.enabled`) so the existing
 * message-count metrics stay unless a caller turns them off.
 *
 * [labelMaxWidth] defaults to 200 (`lsd.mono.label.maxWidth`): the width the diagram cuts message
 * labels to. The full label stays in the report and the side panel. Kotlin cuts nothing; the report
 * UI's `DEFAULT_LABEL_MAX_WIDTH` (lsd-mono-report-html ui/src/ui/format.ts) keeps in step with
 * [DEFAULT_LABEL_MAX_WIDTH].
 */
internal data class ReportOptions(
    val metricsEnabled: Boolean = true,
    val labelMaxWidth: Int = DEFAULT_LABEL_MAX_WIDTH,
    /** `lsd.mono.report.usagePing`, default on. The page also needs a release version to ping. */
    val usagePing: Boolean = true,
) {
    companion object {
        const val DEFAULT_LABEL_MAX_WIDTH = 200

        @JvmStatic
        fun fromProperties(): ReportOptions =
            ReportOptions(
                metricsEnabled = LsdProperties.metricsEnabled(),
                labelMaxWidth = LsdProperties.labelMaxWidth(),
                usagePing = LsdProperties.usagePing(),
            )
    }
}
