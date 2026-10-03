package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties

/**
 * Greenfield report switches. Not a port of PlantUML [com.lsd.core.ReportOptions]:
 * no diagram theme and no `maxEventsPerDiagram` split.
 *
 * [metricsEnabled] defaults **on** (`lsd.mono.metrics.enabled`, legacy
 * `lsd.core.metrics.enabled` fallback) so the existing message-count metrics stay
 * unless a caller turns them off.
 *
 * [labelMaxWidth] defaults to 200 (`lsd.mono.label.maxWidth`, legacy
 * `lsd.core.label.maxWidth` fallback). Full labels stay on events; summaries and
 * the SVG shell truncate to this width.
 */
data class ReportOptions(
    val metricsEnabled: Boolean = true,
    val labelMaxWidth: Int = DEFAULT_LABEL_MAX_WIDTH,
) {
    companion object {
        const val DEFAULT_LABEL_MAX_WIDTH = 200

        @JvmStatic
        fun fromProperties(): ReportOptions =
            ReportOptions(
                metricsEnabled = LsdProperties.metricsEnabled(),
                labelMaxWidth = LsdProperties.labelMaxWidth(),
            )
    }
}
