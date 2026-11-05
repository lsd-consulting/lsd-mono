package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNotSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeFalse
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.time.Duration
import java.util.concurrent.atomic.AtomicReference

/** Runs a fake browser launcher: a node that forks a long-lived child, then sleeps. */
@Timeout(60)
class BrowserLauncherTest {
    private val windows = System.getProperty("os.name").lowercase().contains("windows")

    @TempDir
    lateinit var dir: File

    /**
     * A launcher that writes its own pid and a forked child's pid, then sleeps for a minute. The
     * child exits by itself after two minutes, so a failed test cannot leak it.
     */
    private fun fakeLauncher(): List<String> {
        val pids = File(dir, "pids").path.replace("\\", "\\\\")
        val script =
            "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); setTimeout(() => process.exit(), 120000)'], " +
                "{ stdio: 'ignore', detached: true }); c.unref(); " +
                "require('fs').writeFileSync('$pids', process.pid + ' ' + c.pid); " +
                "setTimeout(() => {}, 60000)"
        return listOf("node", "-e", script)
    }

    private fun pids(): List<Long> {
        val file = File(dir, "pids")
        val deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos()
        while (System.nanoTime() < deadline) {
            if (file.isFile && file.readText().isNotBlank())
                return file
                    .readText()
                    .trim()
                    .split(" ")
                    .map { it.toLong() }
            Thread.sleep(50)
        }
        error("the fake launcher never wrote its pids")
    }

    private fun alive(pid: Long) = ProcessHandle.of(pid).map { it.isAlive }.orElse(false)

    @Test
    fun `returns at once, reaps only the launcher after the timeout, and leaves its child running`() {
        assumeFalse(windows, "signals and detached children differ on Windows")
        val started = System.nanoTime()
        val thread = BrowserLauncher.launch(fakeLauncher(), timeout = Duration.ofSeconds(2))
        val elapsed = Duration.ofNanos(System.nanoTime() - started)
        val (launcher, child) = pids()
        try {
            assertTrue(elapsed < Duration.ofSeconds(1), "launch blocked the caller")
            assertNotSame(Thread.currentThread(), thread)
            assertTrue(thread.isDaemon)
            thread.join(Duration.ofSeconds(15).toMillis())
            assertFalse(thread.isAlive, "the launcher was not reaped within the timeout")
            assertFalse(alive(launcher), "the launcher is still running")
            assertTrue(alive(child), "the launcher's child was killed with it")
        } finally {
            ProcessHandle.of(child).ifPresent { it.destroyForcibly() }
        }
    }

    @Test
    fun `a launcher that cannot start is reported, not thrown`() {
        val failure = AtomicReference<Exception>()
        val thread = BrowserLauncher.launch(listOf("lsd-no-such-browser-launcher")) { failure.set(it) }
        thread.join(Duration.ofSeconds(10).toMillis())
        assertFalse(thread.isAlive)
        assertNotNull(failure.get())
    }

    @Test
    fun `the default timeout is bounded`() {
        assertEquals(Duration.ofSeconds(10), ProcessRunner.BROWSER_TIMEOUT)
    }

    @Test
    fun `browses only when asked to and not on CI`() {
        assertTrue(BrowserLauncher.shouldBrowse(openBrowser = true, ci = false))
        assertFalse(BrowserLauncher.shouldBrowse(openBrowser = false, ci = false))
        assertFalse(BrowserLauncher.shouldBrowse(openBrowser = true, ci = true))
        assertFalse(BrowserLauncher.shouldBrowse(openBrowser = false, ci = true))
    }

    @Test
    fun `browse launches the OS launcher for the url only when allowed`() {
        val launched = mutableListOf<List<String>>()
        assertTrue(BrowserLauncher.browse("http://x", openBrowser = true, ci = false, os = "Linux") { launched += it })
        assertEquals(listOf(listOf("xdg-open", "http://x")), launched)
        assertFalse(BrowserLauncher.browse("http://y", openBrowser = false, ci = false, os = "Linux") { launched += it })
        assertFalse(BrowserLauncher.browse("http://z", openBrowser = true, ci = true, os = "Linux") { launched += it })
        assertEquals(1, launched.size)
    }

    @Test
    fun `picks the OS launcher`() {
        assertEquals(listOf("open", "u"), BrowserLauncher.command("Mac OS X", "u"))
        assertEquals(listOf("rundll32", "url.dll,FileProtocolHandler", "u"), BrowserLauncher.command("Windows 11", "u"))
        assertEquals(listOf("xdg-open", "u"), BrowserLauncher.command("Linux", "u"))
    }
}
