package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException

/** Decides whether what answers `GET /api/reports` on a port is an LSD Studio this build can reuse. */
internal object StudioProbe {
    /** The header LSD Studio puts on its HTTP responses, valued with its npm version; see the lsd-mono-studio README. */
    const val STUDIO_HEADER = "X-LSD-Studio"

    /** What to do about the server on a port. */
    sealed interface Verdict {
        /** Reuse it; [warning] is set when its version is not the one this build runs. */
        data class Reuse(
            val version: String,
            val warning: String?,
        ) : Verdict

        /** Something this build cannot reuse holds the port. */
        data class InUse(
            val failure: GradleException,
        ) : Verdict
    }

    /**
     * The verdict on a `GET /api/reports` that answered [status] with [header] as the [STUDIO_HEADER]
     * value. [expected] is the Studio version this build runs, or null when it is not known.
     */
    fun judge(
        url: String,
        port: Int,
        status: Int,
        header: String?,
        expected: String?,
    ): Verdict {
        val version = header?.trim()?.takeIf { it.isNotEmpty() }
        if (version == null) {
            val what = if (header == null) "without an $STUDIO_HEADER header" else "with an empty $STUDIO_HEADER header"
            return Verdict.InUse(portInUse(port, expected, "GET /api/reports answered $status $what"))
        }
        if (status != 200) {
            return Verdict.InUse(
                GradleException(
                    "LSD Studio $version is on port $port, but GET /api/reports answered $status. " +
                        "Stop it, or choose another port: ${portHint(port)}.",
                ),
            )
        }
        val warning =
            if (expected == null || version == expected) {
                null
            } else {
                "LSD Studio $version is running on $url, but this build runs LSD Studio $expected: using it anyway, " +
                    "but its live view may not line up with this build. Stop it to start $expected here."
            }
        return Verdict.Reuse(version, warning)
    }

    /** The failure for a [port] held by an older Studio or another app; [why] says what was seen. */
    fun portInUse(
        port: Int,
        expected: String?,
        why: String,
        cause: Throwable? = null,
    ): GradleException {
        val older = if (expected == null) "An older LSD Studio" else "An LSD Studio older than $expected"
        return GradleException(
            "$older, or another app, is using port $port ($why). Stop it, or choose another port: ${portHint(port)}.",
            cause,
        )
    }

    /** The setting with a free-looking neighbour of [port]; never past the last port. */
    fun portHint(port: Int): String = "lsdStudio { port = ${if (port < 65535) port + 1 else port - 1} }"
}
