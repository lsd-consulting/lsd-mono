package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.ReportOptions
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.model.MetricJson

/**
 * A scenario's metrics: its message count and, when any message has a duration, their sum.
 * Each message counts its [Message.timedMs]: an explicit `took` or [io.lsdconsulting.lsd.mono.core.Timing]
 * duration first, then the call-to-reply time, then the legacy whole-ms duration. So a scenario whose
 * durations are all given reports the same total on every run.
 * Slow calls are shown by the Timing view (summary strip, swim lanes and waterfall), not here.
 *
 * Empty when [ReportOptions.metricsEnabled] is false.
 */
internal fun capturedMetrics(events: List<SequenceEvent>, options: ReportOptions): List<MetricJson> {
    if (!options.metricsEnabled) return emptyList()
    val messages = events.filterIsInstance<Message>()
    val duration = messages.mapNotNull { it.timedMs }.sum()
    return buildList {
        add(MetricJson("Messages", messages.size.toString()))
        if (duration > 0) add(MetricJson("Captured duration", "${formatMs(duration)} ms"))
    }
}

/** Whole milliseconds as `42`, fractions to at most three places as `17.625`. */
internal fun formatMs(ms: Double): String {
    val rounded = Math.round(ms * 1000) / 1000.0
    if (rounded == Math.rint(rounded)) return rounded.toLong().toString()
    return java.math.BigDecimal
        .valueOf(rounded)
        .stripTrailingZeros()
        .toPlainString()
}
