package io.lsdconsulting.lsd.mono.core.properties

/**
 * Every property lsd-mono reads, with its legacy alias and default: the one place they
 * are defined. The table in the lsd-mono-core README documents the same rows, and
 * `LsdPropertiesTest` fails when the two differ.
 *
 * A key is looked up in each source in turn (see [LsdConfig]: system property, environment
 * variable, JUnit configuration parameters, `lsd-mono.properties`). When it is set in none,
 * its [legacy] name is looked up the same way, and only then is [default] used.
 */
internal enum class LsdKey(
    val key: String,
    val legacy: String?,
    val default: String?,
) {
    OUTPUT_DIR(LsdProperties.OUTPUT_DIR, "lsd.core.report.outputDir", "build/reports/lsd"),
    DETERMINISTIC_IDS(LsdProperties.DETERMINISTIC_IDS, "lsd.core.ids.deterministic", "false"),
    HIDE_STACKTRACE(LsdProperties.HIDE_STACKTRACE, "lsd.junit.hideStacktrace", "false"),
    METRICS_ENABLED(LsdProperties.METRICS_ENABLED, "lsd.core.metrics.enabled", "true"),
    LABEL_MAX_WIDTH(LsdProperties.LABEL_MAX_WIDTH, "lsd.core.label.maxWidth", "200"),
    GENERATED_AT(LsdProperties.GENERATED_AT, null, null),
    USAGE_PING(LsdProperties.USAGE_PING, null, "true"),
    CUCUMBER_SPLIT_BY_STEPS(LsdProperties.CUCUMBER_SPLIT_BY_STEPS, null, "false"),
    PAYLOAD_MAX_DEPTH(LsdProperties.PAYLOAD_MAX_DEPTH, null, "32"),
    PAYLOAD_MAX_STRING_LENGTH(LsdProperties.PAYLOAD_MAX_STRING_LENGTH, null, "100000"),
    PAYLOAD_MAX_ITEMS(LsdProperties.PAYLOAD_MAX_ITEMS, null, "1000"),
    PAYLOAD_MAX_TOTAL_SIZE(LsdProperties.PAYLOAD_MAX_TOTAL_SIZE, null, "1000000"),
    PAYLOAD_REDACT(LsdProperties.PAYLOAD_REDACT, null, "true"),
    PAYLOAD_REDACT_KEYS(LsdProperties.PAYLOAD_REDACT_KEYS, null, null),
    PROPAGATION_ALLOWED_HOSTS(LsdProperties.PROPAGATION_ALLOWED_HOSTS, null, "localhost,127.0.0.1,::1"),
    INHERIT_BINDING(LsdProperties.INHERIT_BINDING, null, "true"),
    TIMING_ORDER_BY_STARTED_AT(LsdProperties.TIMING_ORDER_BY_STARTED_AT, null, "source"),
    ;

    /** The value the user set under the key or, failing that, its legacy name; else [default]. */
    fun value(): String? = explicit(key) ?: legacy?.let(::explicit) ?: default

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

    private fun explicit(name: String): String? = LsdConfig.lookup(name)

    internal companion object {
        fun parseBoolean(raw: String?): Boolean? =
            when (raw?.trim()?.lowercase()) {
                "true", "yes", "on", "1" -> true
                "false", "no", "off", "0" -> false
                else -> null
            }
    }
}
