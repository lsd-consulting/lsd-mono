package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException

/** Turns what `node --version` did into the Node.js version, or a clear failure. */
internal object NodeCheck {
    fun notFound(
        node: String,
        reason: String?,
        cause: Throwable? = null,
    ): GradleException =
        GradleException(
            "LSD Studio needs Node.js ${NodeVersion.MINIMUM} or newer, and '$node' failed or was not found " +
                "($reason). Install Node.js (https://nodejs.org) and put it on the PATH, or set " +
                "lsdStudio { nodeCommand = \"/path/to/node\" }.",
            cause,
        )

    /**
     * The version [node] reported in [result]. Through cmd on Windows, a missing command is a
     * non-zero exit (9009, "is not recognized") rather than a failure to start.
     */
    fun version(
        node: String,
        result: ProcessResult,
    ): NodeVersion {
        if (result.exitCode != 0) throw notFound(node, "exit ${result.exitCode}: ${result.output.trim()}")
        val output = result.output
        val version =
            NodeVersion.parse(output.lineSequence().firstOrNull { it.isNotBlank() } ?: "")
                ?: throw GradleException("Could not read the Node.js version from '$node --version': '${output.trim()}'")
        if (version < NodeVersion.MINIMUM) {
            throw GradleException(
                "LSD Studio needs Node.js ${NodeVersion.MINIMUM} or newer, and '$node' is $version. " +
                    "Install a newer Node.js, or point lsdStudio { nodeCommand = … } at one.",
            )
        }
        return version
    }
}
