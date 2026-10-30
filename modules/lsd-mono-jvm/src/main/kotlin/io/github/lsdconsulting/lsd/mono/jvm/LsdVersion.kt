package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.report.model.GeneratorJson
import java.util.Properties

/**
 * The `lsd-mono-jvm` version that wrote a report.
 *
 * The build writes `lsd-mono-jvm/version.properties` from the Gradle project version, so
 * this is right in tests and in the jar alike. The jar manifest's `Implementation-Version`
 * is the fallback, then `unknown`.
 */
internal object LsdVersion {
    private const val RESOURCE = "/lsd-mono-jvm/version.properties"

    val version: String by lazy { fromResource() ?: fromManifest() ?: "unknown" }

    /** Value of the report's `generator` field: `lsd-mono-jvm` and this version, when it is known. */
    val generator: GeneratorJson
        get() = GeneratorJson("lsd-mono-jvm", version.takeIf { it != "unknown" })

    private fun fromResource(): String? =
        LsdVersion::class.java.getResourceAsStream(RESOURCE)?.use { stream ->
            Properties()
                .apply { load(stream) }
                .getProperty("version")
                ?.trim()
                ?.takeIf { it.isNotEmpty() }
        }

    private fun fromManifest(): String? = LsdVersion::class.java.`package`?.implementationVersion
}
