package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.logging.Logging
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

    /** Unregistered by [close]; internal so tests can check that. */
    internal val hook = Thread(::stopAll, "lsd-studio-shutdown")

    init {
        Runtime.getRuntime().addShutdownHook(hook)
    }

    internal fun add(process: Process) {
        running += process
    }

    internal fun remove(process: Process) {
        running -= process
    }

    /** The processes still held, for tests. */
    internal fun held(): Set<Process> = running.toSet()

    /**
     * Stops every process still running; the shutdown hook and [close] both come here. If the
     * daemon exits while the service is closing, both can stop the same process at once: that is
     * harmless, as [stop] on a process that is already stopping or gone just waits or returns.
     */
    internal fun stopAll() {
        running.toList().forEach {
            try {
                stop(it)
            } catch (e: Exception) {
                // Carry on, so one failure doesn't leave the others running.
                logger.warn("LSD Studio: could not stop {}: {}", it, e.toString())
            } finally {
                running -= it
            }
        }
    }

    override fun close() {
        try {
            stopAll()
        } finally {
            // Always unregister, or each build would leave a hook behind in the daemon.
            runCatching { Runtime.getRuntime().removeShutdownHook(hook) }
        }
    }

    internal companion object {
        private val logger = Logging.getLogger(StudioProcesses::class.java)
        private val GRACE_NANOS = TimeUnit.SECONDS.toNanos(5)
        private const val POLL_MILLIS = 50L

        /**
         * Stops [process] and anything it started: children first, then the process, politely, then
         * forcibly after a few seconds. Node is started directly (no npx or .cmd shim), so on
         * Windows too there is no wrapper left holding the port.
         *
         * Children are listed again while the process shuts down, so one it starts late (even in
         * its own SIGTERM handler) is stopped too. A child whose parent has died is reparented and no
         * longer listed, so every child seen is kept.
         */
        fun stop(process: Process) {
            // Called after Ctrl+C too: the thread is interrupted then, and waiting would throw at
            // once and skip the forced kill. Clear the flag while stopping and set it again after.
            var interrupted = Thread.interrupted()
            try {
                interrupted = stopTree(process) || interrupted
            } finally {
                if (interrupted) Thread.currentThread().interrupt()
            }
        }

        /** True if the thread was interrupted again while stopping: the forced kill still runs. */
        private fun stopTree(process: Process): Boolean {
            val seen = LinkedHashSet<ProcessHandle>()
            var interrupted = false

            // Politely stops any child not seen before; true if there was one.
            fun stopNewChildren(): Boolean =
                process
                    .toHandle()
                    .descendants()
                    .toList()
                    .filter { seen.add(it) }
                    .onEach { it.destroy() }
                    .isNotEmpty()

            try {
                val deadline = System.nanoTime() + GRACE_NANOS
                // Until none are new, so one started since the first look is not missed.
                var more = stopNewChildren()
                while (more && System.nanoTime() < deadline) {
                    Thread.sleep(POLL_MILLIS)
                    more = stopNewChildren()
                }
                process.destroy()
                // Keep looking while it shuts down: it may start a child even in its SIGTERM handler.
                // One started in the instant before it exits can still be missed.
                while (!process.waitFor(POLL_MILLIS, TimeUnit.MILLISECONDS) && System.nanoTime() < deadline) {
                    stopNewChildren()
                }
                // Children that outlive the process get what is left of the grace period.
                if (!process.isAlive) {
                    while (seen.any { it.isAlive } && System.nanoTime() < deadline) Thread.sleep(POLL_MILLIS)
                }
            } catch (e: InterruptedException) {
                // Cancelled twice: skip the rest of the grace period, but still force what is left.
                interrupted = true
            }
            if (process.isAlive) {
                stopNewChildren()
                seen.forEach { it.destroyForcibly() }
                process.destroyForcibly()
                try {
                    process.waitFor(5, TimeUnit.SECONDS)
                } catch (e: InterruptedException) {
                    interrupted = true
                }
            }
            (seen + process.toHandle().descendants().toList()).forEach { handle ->
                if (handle.isAlive) handle.destroyForcibly()
            }
            return interrupted
        }
    }
}
