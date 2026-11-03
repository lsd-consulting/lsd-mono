package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.Action
import org.gradle.api.Task
import org.gradle.api.logging.Logging
import org.gradle.api.provider.Provider
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.testing.Test
import org.gradle.process.CommandLineArgumentProvider
import java.io.IOException
import java.net.HttpURLConnection
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
) : Action<Task>,
    CommandLineArgumentProvider {
    @get:Internal
    internal var url: String? = null

    override fun execute(task: Task) {
        url = null
        if (!enabled.get()) return
        val test = task as Test
        if (userSet(test.systemProperties, test.environment, test.jvmArgs.orEmpty())) {
            logger.info("LSD Studio: {} already sets {}, so it is left as it is.", task.path, STUDIO_URL_PROPERTY)
            return
        }
        val port = port.get()
        if (port == 0) {
            logger.info("LSD Studio: lsdStudio { port = 0 } picks a port at random, so tests are not pointed at it.")
            return
        }
        url = probe(port)
        if (url != null) logger.lifecycle("LSD Studio is running: {} streams its reports to {}", task.path, url)
    }

    override fun asArguments(): Iterable<String> = url?.let { listOf("-D$STUDIO_URL_PROPERTY=$it") } ?: emptyList()

    internal companion object {
        /** The property lsd-mono-jvm reads the live-capture URL from. */
        const val STUDIO_URL_PROPERTY = "lsd.mono.studio.url"

        /** The environment variable lsd-mono-jvm also reads it from. */
        const val STUDIO_URL_ENV = "LSD_MONO_STUDIO_URL"

        /** How long the port check may take, connecting and reading each. */
        const val PROBE_TIMEOUT_MILLIS = 300

        private val logger = Logging.getLogger(StudioUrlWiring::class.java)

        /** Whether the task already sets the URL, as a system property, a JVM argument or an environment variable. */
        fun userSet(
            systemProperties: Map<String, Any?>,
            environment: Map<String, Any?>,
            jvmArgs: List<String>,
        ): Boolean =
            STUDIO_URL_PROPERTY in systemProperties ||
                STUDIO_URL_ENV in environment ||
                jvmArgs.any { it.startsWith("-D$STUDIO_URL_PROPERTY=") || it == "-D$STUDIO_URL_PROPERTY" }

        /** The live-capture URL of an LSD Studio answering on [port], or null when none does. */
        fun probe(port: Int): String? {
            val base = "http://127.0.0.1:$port"
            return try {
                val connection = URI("$base/api/reports").toURL().openConnection() as HttpURLConnection
                connection.connectTimeout = PROBE_TIMEOUT_MILLIS
                connection.readTimeout = PROBE_TIMEOUT_MILLIS
                connection.instanceFollowRedirects = false
                try {
                    val verdict =
                        StudioProbe.judge(base, port, connection.responseCode, connection.getHeaderField(StudioProbe.STUDIO_HEADER), null)
                    if (verdict is StudioProbe.Verdict.Reuse) {
                        "ws://127.0.0.1:$port/ws/captures"
                    } else {
                        logger.info("LSD Studio: not running on port {}, so tests are not pointed at it.", port)
                        null
                    }
                } finally {
                    connection.disconnect()
                }
            } catch (e: IOException) {
                logger.info("LSD Studio: not running on port {} ({}), so tests are not pointed at it.", port, e.toString())
                null
            }
        }
    }
}
