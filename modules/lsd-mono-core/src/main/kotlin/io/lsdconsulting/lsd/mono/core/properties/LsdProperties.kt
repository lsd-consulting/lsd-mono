package io.lsdconsulting.lsd.mono.core.properties

import io.lsdconsulting.lsd.mono.core.InternalLsdApi
import java.time.Instant
import java.time.format.DateTimeParseException

/**
 * The names of the properties lsd-mono reads. Each is taken from, in order: the system
 * property; the environment variable (`LSD_MONO_REPORT_OUTPUTDIR`); JUnit configuration
 * parameters such as `junit-platform.properties` (with lsd-mono-junit-jupiter); an
 * `lsd-mono.properties` file at the root of the classpath; and the default. The
 * lsd-mono-core README lists each one with its default and the legacy `lsd.core.*` /
 * `lsd.junit.*` name that is still accepted. Booleans accept `true/false`, `yes/no`, `on/off`
 * and `1/0`; any other value is warned about and the default used.
 */
public object LsdProperties {
    /** Directory reports are written to. Default `build/reports/lsd`. */
    public const val OUTPUT_DIR: String = "lsd.mono.report.outputDir"

    /** `true` numbers ids 1, 2, 3… instead of random ones, for reproducible reports. */
    public const val DETERMINISTIC_IDS: String = "lsd.mono.ids.deterministic"

    /** `true` leaves stack traces out of a failed scenario's error (JUnit and Cucumber). */
    public const val HIDE_STACKTRACE: String = "lsd.mono.hideStacktrace"

    /** Message-count and captured-duration metrics. Default `true`. */
    public const val METRICS_ENABLED: String = "lsd.mono.metrics.enabled"

    /**
     * Clock ordering of events that have a `startedAt` but no measured duration: `false` (off),
     * `source` (default; same source only, also `true`) or `all` (across sources).
     */
    public const val TIMING_ORDER_BY_STARTED_AT: String = "lsd.mono.timing.orderByStartedAt"

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

    /**
     * `false` turns off the built-in list of secret key names (`password`, `token`,
     * `authorization`…) whose values are written as `[lsd: redacted]`. Default `true`.
     */
    public const val PAYLOAD_REDACT: String = "lsd.mono.payload.redact"

    /**
     * Comma-separated hosts that may receive the scenario header (see
     * `LsdContext.scenarioHeaderValue`). An entry is a host name or IP address, `*.example.test`
     * for any subdomain, or `*` for every host. Default `localhost,127.0.0.1,::1`.
     */
    public const val PROPAGATION_ALLOWED_HOSTS: String = "lsd.mono.propagation.allowedHosts"

    /**
     * `false` stops threads from inheriting the scenario of the thread that started them.
     * Default `true`; pool and executor threads never inherit.
     */
    public const val INHERIT_BINDING: String = "lsd.mono.scenario.inheritBinding"

    /** Comma-separated key names to redact as well as the built-in ones, for example `ssn,x-session`. */
    public const val PAYLOAD_REDACT_KEYS: String = "lsd.mono.payload.redactKeys"

    internal fun outputDirectory(): String = checkNotNull(LsdKey.OUTPUT_DIR.value())

    internal fun deterministicIds(): Boolean = LsdKey.DETERMINISTIC_IDS.boolean()

    internal fun hideStacktrace(): Boolean = LsdKey.HIDE_STACKTRACE.boolean()

    internal fun metricsEnabled(): Boolean = LsdKey.METRICS_ENABLED.boolean()

    internal fun clockOrdering(): io.lsdconsulting.lsd.mono.core.ClockOrdering {
        val raw = LsdKey.TIMING_ORDER_BY_STARTED_AT.value()
        return when (raw?.trim()?.lowercase()) {
            "source", "same_source", "true", "yes", "on", "1" -> io.lsdconsulting.lsd.mono.core.ClockOrdering.SAME_SOURCE
            "all", "all_sources" -> io.lsdconsulting.lsd.mono.core.ClockOrdering.ALL_SOURCES
            "false", "off", "no", "0" -> io.lsdconsulting.lsd.mono.core.ClockOrdering.OFF
            else -> {
                LsdConfig.warnOnce(TIMING_ORDER_BY_STARTED_AT, raw.toString()) {
                    "LSD: '$raw' is not valid for $TIMING_ORDER_BY_STARTED_AT, so 'source' is used. Use false, source or all."
                }
                io.lsdconsulting.lsd.mono.core.ClockOrdering.SAME_SOURCE
            }
        }
    }

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

    /** Whether the built-in secret key names are redacted ([PAYLOAD_REDACT]); an unrecognised value keeps it on. */
    internal fun redactDefaults(): Boolean = LsdKey.PAYLOAD_REDACT.boolean()

    /** The extra key names in [PAYLOAD_REDACT_KEYS], trimmed, blanks dropped. */
    internal fun redactKeys(): List<String> =
        LsdKey.PAYLOAD_REDACT_KEYS
            .value()
            ?.split(',')
            ?.map { it.trim() }
            ?.filter { it.isNotEmpty() }
            .orEmpty()

    /** The [PROPAGATION_ALLOWED_HOSTS] entries, trimmed and lower case, blanks dropped. */
    internal fun propagationAllowedHosts(): List<String> =
        LsdKey.PROPAGATION_ALLOWED_HOSTS
            .value()
            .orEmpty()
            .split(',')
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }

    /** Whether threads inherit the starting thread's scenario ([INHERIT_BINDING]); an unrecognised value keeps it on. */
    internal fun inheritBinding(): Boolean = LsdKey.INHERIT_BINDING.boolean()

    /**
     * Look up keys in [source] after system properties and environment variables, and before
     * `lsd-mono.properties`. lsd-mono-junit-jupiter installs JUnit's configuration parameters
     * here. `null` removes the source. [source] returns null for a key it does not set.
     */
    @InternalLsdApi
    @JvmStatic
    public fun useConfigurationSource(source: java.util.function.Function<String, String?>?) {
        LsdConfig.useConfigurationSource(source?.let { s -> { key: String -> s.apply(key) } })
    }

    /** Whether the Cucumber plugin starts a section at each step ([CUCUMBER_SPLIT_BY_STEPS]). */
    @InternalLsdApi
    @JvmStatic
    public fun cucumberSplitBySteps(): Boolean = LsdKey.CUCUMBER_SPLIT_BY_STEPS.boolean()
}
