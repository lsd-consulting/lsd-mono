package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.Action
import org.gradle.api.Task
import org.gradle.api.logging.Logging
import org.gradle.api.provider.Provider
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.testing.Test
import org.gradle.process.CommandLineArgumentProvider
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URI

/**
 * Passes `-Dlsd.mono.studio.url` to a [Test] task's JVM when LSD Studio is running on [port] as the
 * test starts, so its reports stream there live (#210). Registered both as a `doFirst` action, which
 * sees whether the user already set the URL on the task, and as a JVM argument provider. Nothing it
 * holds is an input: whether Studio is up never makes a test out of date.
 */
internal class StudioUrlWiring(
    @get:Internal val port: Provider<Int>,
    @get:Internal val enabled: Provider<Boolean>,
    @get:Internal val studioPackage: Provider<String>,
    @get:Internal val projectDir: File,
) : Action<Task>,
    CommandLineArgumentProvider {
    @get:Internal
    internal var url: String? = null

    override fun execute(task: Task) {
        // Each build, and each configuration cache load, gets a fresh object, so this only matters
        // if the same task object ever runs twice; it keeps a stale URL from carrying over.
        url = null
        if (!enabled.get()) return
        val test = task as Test
        val fromProviders =
            test.jvmArgumentProviders
                .filter { it !== this }
                .flatMap { provider ->
                    try {
                        provider.asArguments().toList()
                    } catch (e: Exception) {
                        // Not the plugin's to fail: Gradle calls it again for the command line.
                        logger.info("LSD Studio: a JVM argument provider of {} failed when checked ({}), so it is skipped.", task.path, e.toString())
                        emptyList()
                    }
                }
        if (userSet(test.systemProperties, test.environment, test.jvmArgs.orEmpty() + fromProviders)) {
            logger.info("LSD Studio: {} already sets {}, so it is left as it is.", task.path, STUDIO_URL_PROPERTY)
            return
        }
        val port = port.get()
        if (port == 0) {
            logger.info("LSD Studio: lsdStudio { port = 0 } picks a port at random, so tests are not pointed at it.")
            return
        }
        when (val result = probe(port, expectedVersion(studioPackage.orNull, projectDir))) {
            is Probe.Running -> {
                result.mismatch?.let { logger.warn(it) }
                url = result.url
                logger.lifecycle("LSD Studio is running: {} streams its reports to {}", task.path, result.url)
            }
            is Probe.NoAnswer ->
                logger.lifecycle(
                    "LSD Studio: something on port {} did not answer in time, so {} is not streamed to it.",
                    port,
                    task.path,
                )
            is Probe.NotRunning -> logger.info("LSD Studio: not running on port {} ({}), so tests are not pointed at it.", port, result.why)
        }
    }

    override fun asArguments(): Iterable<String> = url?.let { listOf("-D$STUDIO_URL_PROPERTY=$it") } ?: emptyList()

    /** What the port check found. */
    internal sealed interface Probe {
        /** LSD Studio answered; [mismatch] says so when its version is not the one this build runs. */
        data class Running(
            val url: String,
            val mismatch: String?,
        ) : Probe

        /** The port took the connection but sent nothing back in time. */
        data object NoAnswer : Probe

        /** Nothing listening, or something that is not LSD Studio. */
        data class NotRunning(
            val why: String,
        ) : Probe
    }

    internal companion object {
        /** The property lsd-mono-jvm reads the live-capture URL from. */
        const val STUDIO_URL_PROPERTY = "lsd.mono.studio.url"

        /** The environment variable lsd-mono-jvm also reads it from. */
        const val STUDIO_URL_ENV = "LSD_MONO_STUDIO_URL"

        /** How long connecting may take: a refusal on localhost comes back at once. */
        const val CONNECT_TIMEOUT_MILLIS = 300

        /** How long a busy Studio may take to answer once connected. */
        const val READ_TIMEOUT_MILLIS = 1500

        private val logger = Logging.getLogger(StudioUrlWiring::class.java)

        private val NPM_VERSION = Regex("""${StudioVersion.NPM_PACKAGE}@(\d+\.\d+\.\d+.*)""")
        private val RELEASE = Regex("""\d+\.\d+\.\d+""")

        /**
         * The Studio version this build runs, or null when it is not known without installing it:
         * a local directory's package.json, an `lsd-mono-studio@x.y.z` spec, or a released plugin's own version.
         */
        fun expectedVersion(
            studioPackage: String?,
            projectDir: File,
            pluginVersion: String = StudioVersion.plugin,
        ): String? {
            val spec = studioPackage?.trim()?.takeIf { it.isNotEmpty() }
            if (spec == null) return pluginVersion.takeIf { RELEASE.matches(it) }
            StudioPackage.localDirectory(spec, projectDir)?.let { return StudioPackage.version(it.resolve("package.json")) }
            return NPM_VERSION.matchEntire(spec)?.groupValues?.get(1)
        }

        /** Whether the task already sets the URL, as a system property, a JVM argument or an environment variable. */
        fun userSet(
            systemProperties: Map<String, Any?>,
            environment: Map<String, Any?>,
            jvmArgs: List<String>,
        ): Boolean =
            STUDIO_URL_PROPERTY in systemProperties ||
                STUDIO_URL_ENV in environment ||
                jvmArgs.any { it.startsWith("-D$STUDIO_URL_PROPERTY=") || it == "-D$STUDIO_URL_PROPERTY" }

        /** Whether an LSD Studio answers on [port], judged as the `lsdStudio` task judges it ([StudioProbe]). */
        fun probe(
            port: Int,
            expected: String?,
        ): Probe {
            val base = "http://127.0.0.1:$port"
            val connection = URI("$base/api/reports").toURL().openConnection() as HttpURLConnection
            connection.connectTimeout = CONNECT_TIMEOUT_MILLIS
            connection.readTimeout = READ_TIMEOUT_MILLIS
            connection.instanceFollowRedirects = false
            return try {
                connection.connect()
                try {
                    val verdict =
                        StudioProbe.judge(base, port, connection.responseCode, connection.getHeaderField(StudioProbe.STUDIO_HEADER), expected)
                    when (verdict) {
                        is StudioProbe.Verdict.Reuse ->
                            Probe.Running(
                                "ws://127.0.0.1:$port/ws/captures",
                                verdict.warning?.let {
                                    "LSD Studio ${verdict.version} is running on $base, but this build runs LSD Studio $expected: " +
                                        "tests stream to it anyway, but its live view may not line up with them."
                                },
                            )
                        is StudioProbe.Verdict.InUse -> Probe.NotRunning(
                            verdict.failure.message
                                .orEmpty()
                                .lineSequence()
                                .first(),
                        )
                    }
                } catch (e: SocketTimeoutException) {
                    Probe.NoAnswer
                }
            } catch (e: IOException) {
                Probe.NotRunning(e.toString())
            } finally {
                connection.disconnect()
            }
        }
    }
}
