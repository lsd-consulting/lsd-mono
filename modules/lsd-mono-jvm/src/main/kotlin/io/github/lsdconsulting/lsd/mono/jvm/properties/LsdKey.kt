package io.github.lsdconsulting.lsd.mono.jvm.properties

import io.github.lsdconsulting.lsd.mono.jvm.ExperimentalLsdStudioApi

/**
 * Every property lsd-mono reads, with its default: the one place they are defined. The table in the lsd-mono-jvm README documents the same rows, and
 * `LsdPropertiesTest` fails when the two differ.
 *
 * A key is looked up in each source in turn (see [LsdConfig]: system property, environment
 * variable, JUnit configuration parameters, `lsd-mono.properties`); when it is set in none,
 * [default] is used. lsd-core's names for these (`lsd.core.*`, `lsd.junit.*`) are not read.
 */
internal enum class LsdKey(
    val key: String,
    val default: String?,
) {
    OUTPUT_DIR(LsdProperties.OUTPUT_DIR, "build/reports/lsd"),
    DETERMINISTIC_IDS(LsdProperties.DETERMINISTIC_IDS, "false"),
    HIDE_STACKTRACE(LsdProperties.HIDE_STACKTRACE, "false"),
    METRICS_ENABLED(LsdProperties.METRICS_ENABLED, "true"),
    LABEL_MAX_WIDTH(LsdProperties.LABEL_MAX_WIDTH, "200"),
    GENERATED_AT(LsdProperties.GENERATED_AT, null),
    USAGE_PING(LsdProperties.USAGE_PING, "true"),
    CUCUMBER_SPLIT_BY_STEPS(LsdProperties.CUCUMBER_SPLIT_BY_STEPS, "false"),
    PAYLOAD_MAX_DEPTH(LsdProperties.PAYLOAD_MAX_DEPTH, "32"),
    PAYLOAD_MAX_STRING_LENGTH(LsdProperties.PAYLOAD_MAX_STRING_LENGTH, "100000"),
    PAYLOAD_MAX_ITEMS(LsdProperties.PAYLOAD_MAX_ITEMS, "1000"),
    PAYLOAD_MAX_TOTAL_SIZE(LsdProperties.PAYLOAD_MAX_TOTAL_SIZE, "1000000"),
    PAYLOAD_REDACT(LsdProperties.PAYLOAD_REDACT, "true"),
    PAYLOAD_REDACT_KEYS(LsdProperties.PAYLOAD_REDACT_KEYS, null),
    PROPAGATION_ALLOWED_HOSTS(LsdProperties.PROPAGATION_ALLOWED_HOSTS, "localhost,127.0.0.1,::1"),
    INHERIT_BINDING(LsdProperties.INHERIT_BINDING, "true"),
    TIMING_ORDER_BY_STARTED_AT(LsdProperties.TIMING_ORDER_BY_STARTED_AT, "source"),

    @OptIn(ExperimentalLsdStudioApi::class)
    STUDIO_URL(LsdProperties.STUDIO_URL, null),
    ;

    /** The value the user set under the key, else [default]. */
    fun value(): String? = LsdConfig.lookup(key) ?: default

    /**
     * `true`, `yes`, `on` and `1` are true; `false`, `no`, `off` and `0` are false, in any case.
     * Anything else is warned about once and the default is used, rather than meaning false.
     */
    fun boolean(): Boolean {
        val raw = value()
        parseBoolean(raw)?.let { return it }
        val fallback = parseBoolean(default) ?: false
        LsdConfig.warnOnce(key, raw.toString()) {
            "LSD: '$raw' is not a boolean for $key, so the default ($fallback) is used. " +
                "Use true/false, yes/no, on/off or 1/0."
        }
        return fallback
    }

    /** The default of an integer key. */
    fun defaultInt(): Int = checkNotNull(default) { "$key has no default" }.toInt()

    internal companion object {
        fun parseBoolean(raw: String?): Boolean? =
            when (raw?.trim()?.lowercase()) {
                "true", "yes", "on", "1" -> true
                "false", "no", "off", "0" -> false
                else -> null
            }
    }
}
