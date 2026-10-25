package io.lsdconsulting.lsd.mono.http4k

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * The http4k module depends on core, never the other way round: no other module depends on an
 * http4k module, and core and the report modules know nothing of http4k.
 */
class DependencyDirectionTest {
    private val modules = Path.of(System.getProperty("lsd.test.modulesDir"))

    private fun buildFile(module: String): String = modules.resolve(module).resolve("build.gradle.kts").readText()

    @Test
    fun `no other module depends on an http4k module`() {
        val others = modules.listDirectoryEntries().filter { it.resolve("build.gradle.kts").exists() && !it.name.startsWith("lsd-mono-http4k-") }
        assertTrue(others.size >= 3, "found the other modules: $others")
        for (module in others) {
            assertFalse(":modules:lsd-mono-http4k" in buildFile(module.name), "${module.name} depends on an http4k module")
        }
    }

    @Test
    fun `core and the report modules know nothing of http4k`() {
        for (module in listOf("lsd-mono-core", "lsd-mono-report-model", "lsd-mono-report-html")) {
            assertFalse("http4k" in buildFile(module), "$module mentions http4k")
        }
    }
}
