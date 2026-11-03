package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class StudioInstallerTest {
    @TempDir
    lateinit var cache: File

    private val installDir by lazy { cache.resolve("lsd-mono-studio-1.2.3") }

    @Test
    fun `installs once, and a complete install is left alone`() {
        val calls = AtomicInteger()
        assertTrue(
            StudioInstaller.ensureInstalled(installDir, SPEC) {
                calls.incrementAndGet()
                FakeNpm.install(it)
            },
        )
        assertFalse(
            StudioInstaller.ensureInstalled(installDir, SPEC) {
                calls.incrementAndGet()
                FakeNpm.install(it)
            },
        )
        assertEquals(1, calls.get())
        assertTrue(StudioInstaller.isComplete(installDir))
        assertEquals("$SPEC\n", StudioPackage.installedMarker(installDir).readText())
        assertEquals(listOf(installDir.name), leftovers())
    }

    @Test
    fun `concurrent threads and builds install exactly once`() {
        val counter = cache.resolve("npm-calls.txt")
        val startFile = cache.resolve("start")
        val children = (1..2).map { child(counter, startFile) }
        val threads =
            (1..2).map {
                CompletableFuture.supplyAsync {
                    StudioInstallerChild.awaitStart(startFile)
                    StudioInstaller.ensureInstalled(installDir, SPEC) { dir -> FakeNpm.install(dir, counter) }
                }
            }
        // Every participant waits for the start file, so all four reach the lock together.
        Thread.sleep(1000)
        startFile.createNewFile()
        threads.forEach { it.get(60, TimeUnit.SECONDS) }
        children.forEach {
            assertTrue(it.waitFor(60, TimeUnit.SECONDS), "a child JVM did not finish")
            assertEquals(0, it.exitValue(), it.inputStream.bufferedReader().readText())
        }
        assertEquals(1, counter.readLines().size, "npm ran ${counter.readLines().size} times")
        assertTrue(StudioInstaller.isComplete(installDir))
        assertEquals(listOf(installDir.name, counter.name, startFile.name), leftovers())
    }

    @Test
    fun `a failed npm install leaves no install and no temporary folder`() {
        assertThrows<GradleException> {
            StudioInstaller.ensureInstalled(installDir, SPEC) { throw GradleException("npm failed") }
        }
        assertFalse(installDir.exists())
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `an install that npm leaves incomplete is removed with a clear message`() {
        val e =
            assertThrows<GradleException> {
                StudioInstaller.ensureInstalled(installDir, SPEC) {
                    FakeNpm.install(it)
                    FakeNpm.main(it).delete()
                }
            }
        assertTrue(e.message!!.contains("incomplete") && e.message!!.contains("main.js"), e.message)
        assertFalse(installDir.exists())
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `a broken cached install is repaired`() {
        StudioInstaller.ensureInstalled(installDir, SPEC) { FakeNpm.install(it) }
        FakeNpm.main(installDir).delete()
        assertFalse(StudioInstaller.isComplete(installDir))
        val calls = AtomicInteger()
        assertTrue(
            StudioInstaller.ensureInstalled(installDir, SPEC) {
                calls.incrementAndGet()
                FakeNpm.install(it)
            },
        )
        assertEquals(1, calls.get())
        assertTrue(StudioInstaller.isComplete(installDir))
    }

    @Test
    fun `a partial install from a crash, without a marker, is replaced`() {
        FakeNpm.install(installDir)
        assertFalse(StudioInstaller.isComplete(installDir))
        assertTrue(StudioInstaller.ensureInstalled(installDir, SPEC) { FakeNpm.install(it) })
        assertTrue(StudioInstaller.isComplete(installDir))
    }

    @Test
    fun `an install whose bin entry names a missing script is incomplete`() {
        val e =
            assertThrows<GradleException> {
                StudioInstaller.ensureInstalled(installDir, SPEC) {
                    FakeNpm.install(it)
                    FakeNpm.script(it).delete()
                }
            }
        assertTrue(e.message!!.contains("lsd-mono-studio.js is missing"), e.message)
        assertEquals(emptyList<String>(), leftovers())
    }

    @Test
    fun `an install for a different spec is replaced`() {
        StudioInstaller.ensureInstalled(installDir, "lsd-mono-studio@1.2.2") { FakeNpm.install(it) }
        assertFalse(StudioInstaller.isComplete(installDir, SPEC))
        assertTrue(StudioInstaller.ensureInstalled(installDir, SPEC) { FakeNpm.install(it) })
        assertEquals("$SPEC\n", StudioPackage.installedMarker(installDir).readText())
        assertEquals(listOf(installDir.name), leftovers())
    }

    @Test
    fun `folders left by a killed build are removed under the lock`() {
        val tmp = cache.resolve("${installDir.name}.tmp-123").apply { mkdirs() }
        val old = cache.resolve("${installDir.name}.old-abc").apply { mkdirs() }
        val other = cache.resolve("other.tmp-1").apply { mkdirs() }
        StudioInstaller.ensureInstalled(installDir, SPEC) { FakeNpm.install(it) }
        assertFalse(tmp.exists())
        assertFalse(old.exists())
        assertTrue(other.exists(), "folders of other installs are left alone")
    }

    @Test
    fun `a broken install that cannot be moved aside fails clearly and is kept`() {
        FakeNpm.install(installDir)
        val failing = StudioInstaller.Mover { _, _ -> throw IOException("in use") }
        val e = assertThrows<GradleException> { StudioInstaller.ensureInstalled(installDir, SPEC, mover = failing) { FakeNpm.install(it) } }
        assertTrue(e.message!!.contains("in use") && e.message!!.contains("Stop any LSD Studio"), e.message)
        assertTrue(installDir.isDirectory)
        assertEquals(listOf(installDir.name), leftovers())
    }

    @Test
    fun `the final move is retried, then fails clearly`() {
        val attempts = AtomicInteger()
        val flaky =
            StudioInstaller.Mover { from, to ->
                if (attempts.incrementAndGet() == 1) throw IOException("held open")
                Files.move(from, to, StandardCopyOption.ATOMIC_MOVE)
            }
        assertTrue(StudioInstaller.ensureInstalled(installDir, SPEC, mover = flaky) { FakeNpm.install(it) })
        assertEquals(2, attempts.get())
        assertTrue(StudioInstaller.isComplete(installDir, SPEC))

        val other = cache.resolve("lsd-mono-studio-2.0.0")
        attempts.set(0)
        val broken = StudioInstaller.Mover { _, _ ->
            attempts.incrementAndGet()
            throw IOException("held open")
        }
        val e = assertThrows<GradleException> { StudioInstaller.ensureInstalled(other, SPEC, mover = broken) { FakeNpm.install(it) } }
        assertTrue(e.message!!.contains("Could not move"), e.message)
        assertEquals(StudioInstaller.MOVE_ATTEMPTS, attempts.get())
        assertFalse(other.exists())
    }

    @Test
    fun `a file system without atomic moves fails at once`() {
        val attempts = AtomicInteger()
        val unsupported = StudioInstaller.Mover {
            from,
            to,
            ->
            attempts.incrementAndGet()
            throw AtomicMoveNotSupportedException(from.toString(), to.toString(), "no")
        }
        val e = assertThrows<GradleException> { StudioInstaller.ensureInstalled(installDir, SPEC, mover = unsupported) { FakeNpm.install(it) } }
        assertTrue(e.message!!.contains("in one step"), e.message)
        assertEquals(1, attempts.get())
    }

    @Test
    fun `waits while another class loader in this JVM holds the lock, up to a timeout`() {
        val lockFile = cache.resolve("${installDir.name}.lock")
        FileChannel.open(lockFile.toPath(), StandardOpenOption.CREATE, StandardOpenOption.WRITE).use { channel ->
            val held = channel.lock()
            val e = assertThrows<GradleException> {
                StudioInstaller.ensureInstalled(installDir, SPEC, lockTimeout = Duration.ofMillis(300)) { FakeNpm.install(it) }
            }
            assertTrue(e.message!!.contains("Waited"), e.message)
            val install = CompletableFuture.supplyAsync { StudioInstaller.ensureInstalled(installDir, SPEC) { FakeNpm.install(it) } }
            Thread.sleep(500)
            assertFalse(install.isDone, "installed while the lock was held")
            held.release()
            assertTrue(install.get(30, TimeUnit.SECONDS))
        }
    }

    /** What is left in the cache, ignoring lock files. */
    private fun leftovers() = cache.list()!!.filterNot { it.endsWith(".lock") }.sorted()

    private fun child(
        counter: File,
        startFile: File,
    ): Process =
        ProcessBuilder(
            File(System.getProperty("java.home"), "bin/java").path,
            "-cp",
            System.getProperty("java.class.path"),
            StudioInstallerChild::class.java.name,
            installDir.path,
            counter.path,
            startFile.path,
        ).redirectErrorStream(true).start()

    companion object {
        const val SPEC = "lsd-mono-studio@1.2.3"
    }
}

/** Stands in for npm: writes the files an installed lsd-mono-studio has, slowly enough to overlap. */
internal object FakeNpm {
    fun install(
        dir: File,
        counter: File? = null,
    ) {
        counter?.appendText("${ProcessHandle.current().pid()}\n")
        Thread.sleep(300)
        val pkg = dir.resolve("node_modules/lsd-mono-studio").apply { mkdirs() }
        pkg.resolve("package.json").writeText("""{"name":"lsd-mono-studio","bin":{"lsd-mono-studio":"bin/lsd-mono-studio.js"}}""")
        pkg.resolve("bin").mkdirs()
        pkg.resolve("bin/lsd-mono-studio.js").writeText("import '../dist/main.js'\n")
        pkg.resolve("dist").mkdirs()
        pkg.resolve("dist/main.js").writeText("\n")
    }

    fun main(dir: File) = dir.resolve("node_modules/lsd-mono-studio/dist/main.js")

    fun script(dir: File) = dir.resolve("node_modules/lsd-mono-studio/bin/lsd-mono-studio.js")
}

/** A second build in its own JVM, for the cross-process lock: `<installDir> <counter> <startFile>`. */
internal object StudioInstallerChild {
    fun awaitStart(startFile: File) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(60)
        while (!startFile.exists()) {
            check(System.nanoTime() < deadline) { "No start file $startFile" }
            Thread.sleep(10)
        }
    }

    @JvmStatic
    fun main(args: Array<String>) {
        awaitStart(File(args[2]))
        StudioInstaller.ensureInstalled(File(args[0]), StudioInstallerTest.SPEC) { FakeNpm.install(it, File(args[1])) }
    }
}
