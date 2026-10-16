package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.ReportOptions
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.ScenarioTiming
import io.lsdconsulting.lsd.mono.core.domain.SequenceEvent
import io.lsdconsulting.lsd.mono.core.model.MetricJson

/**
 * A scenario's metrics: its message count, when any message has a duration their sum, and when any
 * message has a [Message.status] the number of those that are errors (see [isErrorStatus]).
 * The duration is what the report shows ([ScenarioTiming.reportedMs]): each call once (its own duration
 * or its reply's), plus messages that are not part of a call and reply. So a call with a duration and a
 * timed reply is not counted twice, and a scenario whose durations are all given reports the same total
 * on every run.
 * Slow calls are shown by the Timing view (summary strip, swim lanes and waterfall), not here.
 *
 * Empty when [ReportOptions.metricsEnabled] is false.
 */
internal fun capturedMetrics(
    events: List<SequenceEvent>,
    timing: ScenarioTiming,
    options: ReportOptions,
): List<MetricJson> {
    if (!options.metricsEnabled) return emptyList()
    val messages = events.filterIsInstance<Message>()
    val duration = messages.mapNotNull(timing::reportedMs).sum()
    return buildList {
        add(MetricJson("Messages", messages.size.toString()))
        if (duration > 0) add(MetricJson("Captured duration", "${formatMs(duration)} ms"))
        val statuses = messages.mapNotNull { it.status }
        if (statuses.isNotEmpty()) add(MetricJson("Errors", statuses.count(::isErrorStatus).toString()))
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

private val ERROR_WORDS = Regex("""\b(error|errors|fail|failed|failure|fault|timeout|timed out|exception|rejected|denied)\b""", RegexOption.IGNORE_CASE)
private val LEADING_CODE = Regex("""^\s*(\d{3})\b""")

/**
 * Whether an interaction status is an error: an HTTP-style code 400 to 599 (`"503"`, `"404 Not Found"`),
 * or, with no leading code, a word such as `error`, `failed` or `timeout`. The report UI uses the same rule.
 */
internal fun isErrorStatus(status: String): Boolean {
    val code = LEADING_CODE
        .find(status)
        ?.groupValues
        ?.get(1)
        ?.toInt()
    return if (code != null) code in 400..599 else ERROR_WORDS.containsMatchIn(status)
}
