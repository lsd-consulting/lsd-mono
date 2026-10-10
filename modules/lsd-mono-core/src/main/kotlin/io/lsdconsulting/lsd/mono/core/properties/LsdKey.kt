package io.lsdconsulting.lsd.mono.core.properties

/**
 * Every property lsd-mono reads, with its legacy alias and default: the one place they
 * are defined. The table in the lsd-mono-core README documents the same rows, and
 * `LsdPropertiesTest` fails when the two differ.
 *
 * A key is read from the system property, then from the environment variable of the same
 * name in upper case with dots as underscores (`LSD_MONO_REPORT_OUTPUTDIR`). When the key is
 * not set, its [legacy] name is read the same way, and only then is [default] used.
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
    CUCUMBER_SPLIT_BY_STEPS(LsdProperties.CUCUMBER_SPLIT_BY_STEPS, null, "false"),
    PAYLOAD_MAX_DEPTH(LsdProperties.PAYLOAD_MAX_DEPTH, null, "32"),
    PAYLOAD_MAX_STRING_LENGTH(LsdProperties.PAYLOAD_MAX_STRING_LENGTH, null, "100000"),
    PAYLOAD_MAX_ITEMS(LsdProperties.PAYLOAD_MAX_ITEMS, null, "1000"),
    PAYLOAD_MAX_TOTAL_SIZE(LsdProperties.PAYLOAD_MAX_TOTAL_SIZE, null, "1000000"),
    ;

    /** The value the user set under the key or, failing that, its legacy name; else [default]. */
    fun value(): String? = explicit(key) ?: legacy?.let(::explicit) ?: default

    fun boolean(): Boolean = value().toBoolean()

    /** The default of an integer key. */
    fun defaultInt(): Int = checkNotNull(default) { "$key has no default" }.toInt()

    private fun explicit(name: String): String? = System.getProperty(name) ?: System.getenv(name.replace('.', '_').uppercase())
}
