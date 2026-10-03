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
    /** When true, [io.lsdconsulting.lsd.mono.core.LsdContext.completeComponentsReport] is invoked by the JUnit extension. Default false — the stub is not a component graph. */
    const val COMPONENTS_REPORT = "lsd.mono.components.enabled"
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
            setProperty(COMPONENTS_REPORT, "false")
            // Legacy aliases as defaults lookup keys (read via get with fallbacks)
            setProperty("lsd.core.report.outputDir", "build/reports/lsd")
            setProperty("lsd.core.ids.deterministic", "false")
            setProperty("lsd.junit.hideStacktrace", "false")
        }

    private fun resolve(key: String): String? {
        System.getProperty(key)?.let { return it }
        System.getenv(key.replace('.', '_').uppercase())?.let { return it }
        return defaults.getProperty(key)
    }

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
        resolve(OUTPUT_DIR)
            ?: resolve("lsd.core.report.outputDir")
            ?: "build/reports/lsd"

    @JvmStatic
    fun deterministicIds(): Boolean =
        getBoolean(DETERMINISTIC_IDS, getBoolean("lsd.core.ids.deterministic", false))

    @JvmStatic
    fun hideStacktrace(): Boolean =
        getBoolean(HIDE_STACKTRACE, getBoolean("lsd.junit.hideStacktrace", false))

    /** Combined component stub is opt-in until a real renderer exists. */
    @JvmStatic
    fun componentsReportEnabled(): Boolean =
        getBoolean(COMPONENTS_REPORT, false)

    /**
     * Default **true** so reports keep the message-count metrics that shipped before
     * the gate existed. Set `lsd.mono.metrics.enabled=false` (or the legacy key) to omit them.
     */
    @JvmStatic
    fun metricsEnabled(): Boolean =
        getBoolean(METRICS_ENABLED, getBoolean("lsd.core.metrics.enabled", true))

    /** Positive character width. Falls back to legacy `lsd.core.label.maxWidth`, then 200. */
    @JvmStatic
    fun labelMaxWidth(): Int {
        val raw = resolve(LABEL_MAX_WIDTH) ?: resolve("lsd.core.label.maxWidth") ?: "200"
        return raw.toIntOrNull()?.takeIf { it > 0 } ?: 200
    }
}
