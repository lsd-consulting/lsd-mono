package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.services.BuildService
import org.gradle.api.services.BuildServiceParameters
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

/**
 * The Studio processes this build started. Stops any still running when the build ends, however it
 * ends (finished, cancelled or failed); a JVM shutdown hook covers the Gradle daemon exiting.
 * A daemon killed outright (`kill -9`) runs neither, so a Studio it started keeps running.
 */
public abstract class StudioProcesses :
    BuildService<BuildServiceParameters.None>,
    AutoCloseable {
    private val running = ConcurrentHashMap.newKeySet<Process>()
    private val hook = Thread(::stopAll, "lsd-studio-shutdown")

    init {
        Runtime.getRuntime().addShutdownHook(hook)
    }

    internal fun add(process: Process) {
        running += process
    }

    internal fun remove(process: Process) {
        running -= process
    }

    /** Stops every process still running; the shutdown hook and [close] both come here. */
    internal fun stopAll() {
        running.toList().forEach {
            stop(it)
            running -= it
        }
    }

    override fun close() {
        stopAll()
        runCatching { Runtime.getRuntime().removeShutdownHook(hook) }
    }

    internal companion object {
        /**
         * Stops [process] and anything it started: children first, then the process, politely, then
         * forcibly after a few seconds. Node is started directly (no npx or .cmd shim), so on
         * Windows too there is no wrapper left holding the port.
         */
        fun stop(process: Process) {
            val seen = process.toHandle().descendants().toList()
            seen.forEach { it.destroy() }
            process.destroy()
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                // List them again: a child started since the first look would be missed, and one whose
                // parent has died no longer shows, so keep the first list too.
                (seen + process.toHandle().descendants().toList()).forEach { it.destroyForcibly() }
                process.destroyForcibly()
                process.waitFor(5, TimeUnit.SECONDS)
            }
            (seen + process.toHandle().descendants().toList()).forEach { handle ->
                if (handle.isAlive) handle.destroyForcibly()
            }
        }
    }
}
