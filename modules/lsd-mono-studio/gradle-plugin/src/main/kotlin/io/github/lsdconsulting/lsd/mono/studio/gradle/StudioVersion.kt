package io.github.lsdconsulting.lsd.mono.studio.gradle

import java.util.Properties

/** The plugin's own version: the lsd-mono train version it was built at. */
internal object StudioVersion {
    val plugin: String by lazy {
        val properties = Properties()
        StudioVersion::class.java.getResourceAsStream("version.properties")?.use { properties.load(it) }
        properties.getProperty("version") ?: "unknown"
    }

    private val RELEASE = Regex("""\d+\.\d+\.\d+""")

    /**
     * What to run: [override] when given, else `lsd-mono-studio@<version>`. Only release versions
     * are on npm, so a snapshot build of the plugin needs [override].
     */
    fun packageSpec(
        override: String?,
        version: String = plugin,
    ): String {
        override?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        if (RELEASE.matches(version)) return "$NPM_PACKAGE@$version"
        throw IllegalStateException(
            "This lsd-mono-studio Gradle plugin is a development build ($version), and npm only has " +
                "released versions of $NPM_PACKAGE. Point it at one: set lsdStudio { studioPackage = \"…\" } or " +
                "-P${LsdStudioPlugin.STUDIO_PACKAGE_PROPERTY}=… to a directory with a built lsd-mono-studio " +
                "(modules/lsd-mono-studio in an lsd-mono checkout, after npm ci and npm run build), a .tgz from " +
                "npm pack, or an exact released version such as $NPM_PACKAGE@1.2.3.",
        )
    }

    const val NPM_PACKAGE: String = "lsd-mono-studio"
}
