package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
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
        val children = (1..2).map { child(counter) }
        val start = CountDownLatch(1)
        val threads =
            (1..2).map {
                CompletableFuture.supplyAsync {
                    start.await()
                    StudioInstaller.ensureInstalled(installDir, SPEC) { dir -> FakeNpm.install(dir, counter) }
                }
            }
        start.countDown()
        threads.forEach { it.get(60, TimeUnit.SECONDS) }
        children.forEach {
            assertTrue(it.waitFor(60, TimeUnit.SECONDS), "a child JVM did not finish")
            assertEquals(0, it.exitValue(), it.inputStream.bufferedReader().readText())
        }
        assertEquals(1, counter.readLines().size, "npm ran ${counter.readLines().size} times")
        assertTrue(StudioInstaller.isComplete(installDir))
        assertEquals(listOf(installDir.name, counter.name), leftovers().filterNot { it.endsWith(".log") })
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

    /** What is left in the cache, ignoring lock files. */
    private fun leftovers() = cache.list()!!.filterNot { it.endsWith(".lock") }.sorted()

    private fun child(counter: File): Process =
        ProcessBuilder(
            File(System.getProperty("java.home"), "bin/java").path,
            "-cp",
            System.getProperty("java.class.path"),
            StudioInstallerChild::class.java.name,
            installDir.path,
            counter.path,
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
}

/** A second build in its own JVM, for the cross-process lock: `<installDir> <counter>`. */
internal object StudioInstallerChild {
    @JvmStatic
    fun main(args: Array<String>) {
        StudioInstaller.ensureInstalled(File(args[0]), StudioInstallerTest.SPEC) { FakeNpm.install(it, File(args[1])) }
    }
}
