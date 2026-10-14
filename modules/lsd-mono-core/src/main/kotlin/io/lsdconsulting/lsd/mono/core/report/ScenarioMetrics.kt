package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.ReportOptions
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.model.MetricJson

/**
 * A scenario's metrics: its message count and, when any message has a duration, their sum.
 * Slow calls are shown by the Timing view (summary strip, swim lanes and waterfall), not here.
 *
 * Empty when [ReportOptions.metricsEnabled] is false.
 */
internal fun capturedMetrics(events: List<SequenceEvent>, options: ReportOptions): List<MetricJson> {
    if (!options.metricsEnabled) return emptyList()
    val messages = events.filterIsInstance<Message>()
    val duration = messages.mapNotNull { it.durationMs }.sum()
    return buildList {
        add(MetricJson("Messages", messages.size.toString()))
        if (duration > 0) add(MetricJson("Captured duration", "$duration ms"))
    }
}
