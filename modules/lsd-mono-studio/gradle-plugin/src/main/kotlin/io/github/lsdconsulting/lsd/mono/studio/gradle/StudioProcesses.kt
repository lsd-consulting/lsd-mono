package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.services.BuildService
import org.gradle.api.services.BuildServiceParameters
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The Studio processes this build started. Stops any still running when the build ends, however it
 * ends (finished, cancelled or failed); a JVM shutdown hook covers the Gradle daemon exiting.
 */
public abstract class StudioProcesses :
    BuildService<BuildServiceParameters.None>,
    AutoCloseable {
    private val running = ConcurrentHashMap.newKeySet<Process>()
    private val hook = Thread({ running.toList().forEach(::stop) }, "lsd-studio-shutdown")

    init {
        Runtime.getRuntime().addShutdownHook(hook)
    }

    internal fun add(process: Process) {
        running += process
    }

    internal fun remove(process: Process) {
        running -= process
    }

    override fun close() {
        running.toList().forEach(::stop)
        runCatching { Runtime.getRuntime().removeShutdownHook(hook) }
    }

    internal companion object {
        /**
         * Stops [process] and anything it started: children first, then the process, politely, then
         * forcibly after a few seconds. Node is started directly (no npx or .cmd shim), so on
         * Windows too there is no wrapper left holding the port.
         */
        fun stop(process: Process) {
            val descendants = process.toHandle().descendants().toList()
            descendants.forEach { it.destroy() }
            process.destroy()
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                descendants.forEach { it.destroyForcibly() }
                process.destroyForcibly()
                process.waitFor(5, TimeUnit.SECONDS)
            }
            descendants.forEach { handle ->
                if (handle.isAlive) handle.destroyForcibly()
            }
        }
    }
}
