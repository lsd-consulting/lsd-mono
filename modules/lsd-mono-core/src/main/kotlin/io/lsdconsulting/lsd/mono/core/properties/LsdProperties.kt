package io.lsdconsulting.lsd.mono.core.properties

import io.lsdconsulting.lsd.mono.core.InternalLsdApi
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The names of the properties lsd-mono reads. Set them as system properties or environment
 * variables (`LSD_MONO_REPORT_OUTPUTDIR`). The lsd-mono-core README lists each one with its
 * default and the legacy `lsd.core.*` / `lsd.junit.*` name that is still accepted.
 */
public object LsdProperties {
    /** Directory reports are written to. Default `build/reports/lsd`. */
    public const val OUTPUT_DIR: String = "lsd.mono.report.outputDir"

    /** `true` numbers ids 1, 2, 3… instead of random ones, for reproducible reports. */
    public const val DETERMINISTIC_IDS: String = "lsd.mono.ids.deterministic"

    /** `true` leaves stack traces out of a failed scenario's error (JUnit and Cucumber). */
    public const val HIDE_STACKTRACE: String = "lsd.mono.junit.hideStacktrace"

    /** Duration insights and message-count metrics. Default `true`. */
    public const val METRICS_ENABLED: String = "lsd.mono.metrics.enabled"

    /** Width summaries and the diagram truncate labels to. Default 200. */
    public const val LABEL_MAX_WIDTH: String = "lsd.mono.label.maxWidth"

    /**
     * A fixed ISO-8601 instant (for example `2026-01-01T12:00:00Z`) written as every report's
     * `generatedAt` instead of the time it was written. For reproducible sample reports.
     */
    public const val GENERATED_AT: String = "lsd.mono.report.generatedAt"

    /** `true` makes the Cucumber plugin start a section at each step. */
    public const val CUCUMBER_SPLIT_BY_STEPS: String = "lsd.mono.cucumber.splitBySteps"

    /** Payload nesting depth kept. Default 32. */
    public const val PAYLOAD_MAX_DEPTH: String = "lsd.mono.payload.maxDepth"

    /** Characters kept from one payload string. Default 100000. */
    public const val PAYLOAD_MAX_STRING_LENGTH: String = "lsd.mono.payload.maxStringLength"

    /** Entries kept from one payload collection, map, array or object. Default 1000. */
    public const val PAYLOAD_MAX_ITEMS: String = "lsd.mono.payload.maxItems"

    /** Rough size budget for one payload, in characters. Default 1000000. */
    public const val PAYLOAD_MAX_TOTAL_SIZE: String = "lsd.mono.payload.maxTotalSize"

    internal fun outputDirectory(): String = checkNotNull(LsdKey.OUTPUT_DIR.value())

    internal fun deterministicIds(): Boolean = LsdKey.DETERMINISTIC_IDS.boolean()

    internal fun hideStacktrace(): Boolean = LsdKey.HIDE_STACKTRACE.boolean()

    internal fun metricsEnabled(): Boolean = LsdKey.METRICS_ENABLED.boolean()

    /** The fixed [GENERATED_AT] instant, or null when it is unset or not an ISO-8601 instant. */
    internal fun generatedAt(): Instant? =
        LsdKey.GENERATED_AT.value()?.trim()?.takeIf { it.isNotEmpty() }?.let {
            try {
                Instant.parse(it)
            } catch (_: DateTimeParseException) {
                null
            }
        }

    /** A positive width; anything else falls back to the default. */
    internal fun labelMaxWidth(): Int =
        LsdKey.LABEL_MAX_WIDTH
            .value()
            ?.toIntOrNull()
            ?.takeIf { it > 0 } ?: LsdKey.LABEL_MAX_WIDTH.defaultInt()

    /** A positive payload limit; anything else falls back to the default. */
    internal fun payloadLimit(key: LsdKey): Int = key
        .value()
        ?.trim()
        ?.toIntOrNull()
        ?.takeIf { it > 0 } ?: key.defaultInt()

    /** Whether the Cucumber plugin starts a section at each step ([CUCUMBER_SPLIT_BY_STEPS]). */
    @InternalLsdApi
    @JvmStatic
    public fun cucumberSplitBySteps(): Boolean = LsdKey.CUCUMBER_SPLIT_BY_STEPS.boolean()
}
