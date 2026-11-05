package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import java.io.File

/** The `npm install` that puts LSD Studio in the cache. */
internal object NpmInstall {
    fun args(
        target: File,
        pkg: String,
        offline: Boolean,
    ): List<String> =
        listOf("install", "--prefix", target.path, "--no-save", "--no-audit", "--no-fund", "--no-package-lock", "--omit=dev") +
            (if (offline) listOf("--offline") else emptyList()) +
            pkg

    /** Under `--offline`, turns npm's cache miss (ENOTCACHED) into an error that says what to do. */
    fun <T> explainOfflineMiss(
        offline: Boolean,
        spec: String,
        install: () -> T,
    ): T =
        try {
            install()
        } catch (e: GradleException) {
            if (!offline || e.message?.contains("ENOTCACHED") != true) throw e
            throw GradleException(
                "LSD Studio: Gradle is offline (--offline) and npm's cache has no copy of $spec. " +
                    "Run once without --offline to install it, or set lsd.studio.package to a local directory or .tgz.",
                e,
            )
        }
}
