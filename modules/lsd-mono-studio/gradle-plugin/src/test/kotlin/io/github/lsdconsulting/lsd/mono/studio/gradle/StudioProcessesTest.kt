package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.services.BuildServiceParameters
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import java.util.concurrent.TimeUnit

/** Stops real Node.js processes, the way Studio is run. */
@Timeout(60)
class StudioProcessesTest {
    private val windows = System.getProperty("os.name").lowercase().contains("windows")

    private fun node(script: String): Process =
        ProcessBuilder("node", "-e", script).redirectErrorStream(true).start()

    /** A node that starts a child node, prints the child's pid, and waits. */
    private fun parentWithChild(): Pair<Process, Long> {
        val parent =
            node(
                "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], " +
                    "{ stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000)",
            )
        val child = parent.inputStream
            .bufferedReader()
            .readLine()
            .trim()
            .toLong()
        return parent to child
    }

    private fun alive(pid: Long) = ProcessHandle.of(pid).map { it.isAlive }.orElse(false)

    private fun assertGone(vararg pids: Long) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        while (pids.any(::alive) && System.nanoTime() < deadline) Thread.sleep(100)
        pids.forEach { assertFalse(alive(it), "pid $it is still running") }
    }

    private fun service() =
        object : StudioProcesses() {
            override fun getParameters(): BuildServiceParameters.None = error("no parameters")
        }

    @Test
    fun `stop ends the process and the child it started`() {
        val (parent, child) = parentWithChild()
        assertTrue(alive(child))
        StudioProcesses.stop(parent)
        assertGone(parent.pid(), child)
    }

    @Test
    fun `stop lets a process finish its own shutdown before forcing it`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        val process = node("process.on('SIGTERM', () => setTimeout(() => process.exit(7), 1000)); console.log('ready'); setInterval(() => {}, 1000)")
        process.inputStream.bufferedReader().readLine()
        val started = System.nanoTime()
        StudioProcesses.stop(process)
        assertEquals(7, process.exitValue(), "it was killed rather than left to exit")
        assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(5))
    }

    @Test
    fun `closing the service stops every process it holds, children too`() {
        val service = service()
        val (first, child) = parentWithChild()
        val second = node("setInterval(() => {}, 1000)")
        service.add(first)
        service.add(second)
        service.close()
        assertGone(first.pid(), child, second.pid())
    }

    @Test
    fun `the shutdown hook's work stops what is still running and skips what was removed`() {
        val service = service()
        val running = node("setInterval(() => {}, 1000)")
        val removed = node("setInterval(() => {}, 1000)")
        service.add(running)
        service.add(removed)
        service.remove(removed)
        try {
            service.stopAll()
            assertGone(running.pid())
            assertTrue(removed.isAlive, "a process the service no longer holds was stopped")
        } finally {
            removed.destroyForcibly()
            service.close()
        }
    }
}
