package io.lsdconsulting.lsd.mono.core.properties

import java.util.Properties

/**
 * Mono property bag. Prefers `lsd.mono.*` keys; falls back to legacy `lsd.core.*`
 * / `lsd.junit.*` system properties for easier migration.
 */
object LsdProperties {
    const val OUTPUT_DIR = "lsd.mono.report.outputDir"
    const val DETERMINISTIC_IDS = "lsd.mono.ids.deterministic"
    const val HIDE_STACKTRACE = "lsd.mono.junit.hideStacktrace"
    /**
     * Duration insights and the simple message-count metrics. Default **true**,
     * matching the previous always-on simple metrics. Legacy key: `lsd.core.metrics.enabled`.
     */
    const val METRICS_ENABLED = "lsd.mono.metrics.enabled"
    /** SVG / summary truncation width. Default 200. Legacy key: `lsd.core.label.maxWidth`. */
    const val LABEL_MAX_WIDTH = "lsd.mono.label.maxWidth"

    private val defaults =
        Properties().apply {
            setProperty(OUTPUT_DIR, "build/reports/lsd")
            setProperty(DETERMINISTIC_IDS, "false")
            setProperty(HIDE_STACKTRACE, "false")
            // Legacy aliases as defaults lookup keys (read via get with fallbacks)
            setProperty("lsd.core.report.outputDir", "build/reports/lsd")
            setProperty("lsd.core.ids.deterministic", "false")
            setProperty("lsd.junit.hideStacktrace", "false")
        }

    /** A value the user set (system property or environment), ignoring defaults. */
    private fun explicit(key: String): String? =
        System.getProperty(key) ?: System.getenv(key.replace('.', '_').uppercase())

    private fun resolve(key: String): String? = explicit(key) ?: defaults.getProperty(key)

    /** Mono key, then legacy key, then the default. Defaults must not hide a legacy value. */
    private fun resolveWithLegacy(key: String, legacy: String): String? =
        explicit(key) ?: explicit(legacy) ?: defaults.getProperty(key)

    @JvmStatic
    operator fun get(key: String): String =
        resolve(key) ?: error("Missing property: $key")

    @JvmStatic
    operator fun get(key: String, default: String): String =
        resolve(key) ?: default

    @JvmStatic
    fun getBoolean(key: String): Boolean =
        resolve(key)?.toBoolean() ?: false

    @JvmStatic
    fun getBoolean(key: String, default: Boolean): Boolean =
        resolve(key)?.toBoolean() ?: default

    /** Output dir with mono key first, then legacy. */
    @JvmStatic
    fun outputDirectory(): String =
        resolveWithLegacy(OUTPUT_DIR, "lsd.core.report.outputDir") ?: "build/reports/lsd"

    @JvmStatic
    fun deterministicIds(): Boolean =
        resolveWithLegacy(DETERMINISTIC_IDS, "lsd.core.ids.deterministic")?.toBoolean() ?: false

    @JvmStatic
    fun hideStacktrace(): Boolean =
        resolveWithLegacy(HIDE_STACKTRACE, "lsd.junit.hideStacktrace")?.toBoolean() ?: false

    /**
     * Default **true** so reports keep the message-count metrics that shipped before
     * the gate existed. Set `lsd.mono.metrics.enabled=false` (or the legacy key) to omit them.
     */
    @JvmStatic
    fun metricsEnabled(): Boolean =
        resolveWithLegacy(METRICS_ENABLED, "lsd.core.metrics.enabled")?.toBoolean() ?: true

    /** Positive character width. Falls back to legacy `lsd.core.label.maxWidth`, then 200. */
    @JvmStatic
    fun labelMaxWidth(): Int {
        val raw = resolveWithLegacy(LABEL_MAX_WIDTH, "lsd.core.label.maxWidth") ?: "200"
        return raw.toIntOrNull()?.takeIf { it > 0 } ?: 200
    }
}
