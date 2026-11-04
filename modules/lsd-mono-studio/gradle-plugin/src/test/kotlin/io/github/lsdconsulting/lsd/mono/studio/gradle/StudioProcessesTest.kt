package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.services.BuildServiceParameters
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.TimeUnit

/** Stops real Node.js processes, the way Studio is run. */
@Timeout(60)
class StudioProcessesTest {
    private val windows = System.getProperty("os.name").lowercase().contains("windows")

    @TempDir
    lateinit var dir: File

    /** [code] as a JavaScript string literal. */
    private fun js(code: String) = "\"" + code.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    /** JavaScript that starts a child node running [code] and returns it. */
    private fun spawn(code: String) =
        "require('child_process').spawn(process.execPath, ['-e', ${js(code)}], { stdio: ['ignore', 'pipe', 'ignore'] })"

    /** JavaScript that prints [what] on its own line, at once (stdout to a pipe can be async). */
    private fun print(what: String) = "require('fs').writeSync(1, String($what) + '\\n')"

    /** JavaScript that writes [what] to [file] at once. */
    private fun write(
        file: File,
        what: String,
    ) = "require('fs').writeFileSync(${js(file.path)}, String($what))"

    private fun Process.line(): String = inputStream.readLine()

    /** One line, read byte by byte so nothing after it is buffered away from the next read. */
    private fun InputStream.readLine(): String {
        val out = StringBuilder()
        while (true) {
            val c = read()
            if (c == -1 || c == '\n'.code) return out.toString().trim()
            out.append(c.toChar())
        }
    }

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
        // Well under the forced kill's 5 s grace plus its 5 s wait, with room for a loaded runner.
        assertTrue(System.nanoTime() - started < TimeUnit.SECONDS.toNanos(15))
    }

    @Test
    fun `stop also ends a child started in the process's SIGTERM handler`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        // Stopping closes the process's output, so the late child's pid comes through a file.
        val pid = dir.resolve("child.pid")
        val process =
            node(
                "process.on('SIGTERM', () => { const c = ${spawn("setInterval(() => {}, 1000)")}; " +
                    "${write(pid, "c.pid")}; setTimeout(() => process.exit(0), 500) }); " +
                    "${print("'ready'")}; setInterval(() => {}, 1000)",
            )
        assertEquals("ready", process.line())
        StudioProcesses.stop(process)
        val child = pid.readText().toLong()
        assertEquals(0, process.exitValue(), "it was killed rather than left to exit")
        assertGone(child)
    }

    @Test
    fun `the forced kill also ends a child started after SIGTERM`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        val stubborn = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
        val pid = dir.resolve("child.pid")
        val process =
            node(
                "process.on('SIGTERM', () => { const c = ${spawn(stubborn)}; ${write(pid, "c.pid")} }); " +
                    "${print("'ready'")}; setInterval(() => {}, 1000)",
            )
        assertEquals("ready", process.line())
        StudioProcesses.stop(process)
        val child = pid.readText().toLong()
        assertGone(process.pid(), child)
    }

    @Test
    fun `a child that ignores SIGTERM is forced once its parent has gone`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        val stubborn = "process.on('SIGTERM', () => {}); ${print("'up'")}; setInterval(() => {}, 1000)"
        val process =
            node(
                "const c = ${spawn(stubborn)}; c.stdout.once('data', () => ${print("c.pid")}); " +
                    "setInterval(() => {}, 1000)",
            )
        val child = process.line().toLong()
        StudioProcesses.stop(process)
        assertGone(process.pid(), child)
    }

    @Test
    fun `children are asked to stop before anything is forced`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        val mark = dir.resolve("child-got-sigterm")
        val polite =
            "process.on('SIGTERM', () => { require('fs').writeFileSync(${js(mark.path)}, 'yes'); process.exit(0) }); " +
                "${print("'up'")}; setInterval(() => {}, 1000)"
        val process =
            node(
                "const c = ${spawn(polite)}; c.stdout.once('data', () => ${print("c.pid")}); " +
                    "setInterval(() => {}, 1000)",
            )
        val child = process.line().toLong()
        StudioProcesses.stop(process)
        assertGone(process.pid(), child)
        assertTrue(mark.exists(), "the child was killed without being asked to stop")
    }

    @Test
    fun `stop still forces a stubborn process when the thread was interrupted, and keeps the interrupt`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        val process = node("process.on('SIGTERM', () => {}); ${print("'ready'")}; setInterval(() => {}, 1000)")
        assertEquals("ready", process.line())
        Thread.currentThread().interrupt()
        try {
            StudioProcesses.stop(process)
            assertTrue(Thread.currentThread().isInterrupted, "the interrupt was swallowed")
        } finally {
            Thread.interrupted()
        }
        assertGone(process.pid())
    }

    @Test
    fun `a child still shutting down after its parent has gone is given the rest of the grace period`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        // The child takes about a second over SIGTERM, then exits 5; a forced kill would leave no file.
        val code = dir.resolve("child.exit")
        val slow =
            "process.on('SIGTERM', () => setTimeout(() => process.exit(5), 1000)); " +
                "process.on('exit', (c) => ${write(code, "c")}); ${print("'up'")}; setInterval(() => {}, 1000)"
        // The parent keeps node's default SIGTERM handling, so it exits at once.
        val process =
            node(
                "const c = ${spawn(slow)}; c.stdout.once('data', () => ${print("c.pid")}); " +
                    "setInterval(() => {}, 1000)",
            )
        val child = process.line().toLong()
        StudioProcesses.stop(process)
        assertGone(process.pid(), child)
        assertTrue(code.exists(), "the child was killed rather than left to exit")
        assertEquals("5", code.readText())
    }

    @Test
    fun `a second interrupt while stopping still forces a stubborn process, and keeps the interrupt`() {
        assumeFalse(windows, "Windows has no SIGTERM: destroy ends the process at once")
        val process = node("process.on('SIGTERM', () => {}); ${print("'ready'")}; setInterval(() => {}, 1000)")
        assertEquals("ready", process.line())
        var failure: Throwable? = null
        var keptInterrupt = false
        val stopper =
            Thread {
                try {
                    StudioProcesses.stop(process)
                    keptInterrupt = Thread.currentThread().isInterrupted
                } catch (e: Throwable) {
                    failure = e
                }
            }
        stopper.start()
        // Well inside the 5 s grace period, while stop is waiting for the process.
        Thread.sleep(500)
        stopper.interrupt()
        stopper.join(TimeUnit.SECONDS.toMillis(30))
        assertEquals(null, failure, "the interrupt escaped stop")
        assertTrue(keptInterrupt, "the interrupt was swallowed")
        assertGone(process.pid())
    }

    @Test
    fun `closing the service unregisters its shutdown hook`() {
        val service = service()
        service.close()
        assertFalse(Runtime.getRuntime().removeShutdownHook(service.hook), "the hook is still registered")
    }

    @Test
    fun `closing the service unregisters its shutdown hook even when stopping fails`() {
        val service = service()
        // An Error is not caught per process, so it escapes stopAll.
        val failing =
            object : Process() {
                override fun getOutputStream(): OutputStream = OutputStream.nullOutputStream()

                override fun getInputStream(): InputStream = InputStream.nullInputStream()

                override fun getErrorStream(): InputStream = InputStream.nullInputStream()

                override fun waitFor(): Int = 0

                override fun exitValue(): Int = 0

                override fun destroy() = Unit

                override fun toHandle(): ProcessHandle = throw AssertionError("cannot stop")
            }
        service.add(failing)
        assertThrows<AssertionError> { service.close() }
        assertFalse(Runtime.getRuntime().removeShutdownHook(service.hook), "the hook is still registered")
    }

    @Test
    fun `stopAll empties the service, so a second call has nothing to stop`() {
        val service = service()
        val process = node("setInterval(() => {}, 1000)")
        service.add(process)
        try {
            service.stopAll()
            assertTrue(service.held().isEmpty(), "stopped processes are still held")
            service.stopAll()
            assertTrue(service.held().isEmpty())
            assertGone(process.pid())
        } finally {
            service.close()
        }
    }

    @Test
    fun `one process that cannot be stopped does not stop the others`() {
        val service = service()
        // A Process without an OS handle: stopping it throws.
        val broken =
            object : Process() {
                override fun getOutputStream(): OutputStream = OutputStream.nullOutputStream()

                override fun getInputStream(): InputStream = InputStream.nullInputStream()

                override fun getErrorStream(): InputStream = InputStream.nullInputStream()

                override fun waitFor(): Int = 0

                override fun exitValue(): Int = 0

                override fun destroy() = Unit
            }
        val first = node("setInterval(() => {}, 1000)")
        val second = node("setInterval(() => {}, 1000)")
        service.add(first)
        service.add(broken)
        service.add(second)
        service.close()
        assertGone(first.pid(), second.pid())
        assertTrue(service.held().isEmpty())
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
