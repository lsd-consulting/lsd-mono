package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * The starter depends on core (and, through it, the report model), never the other way round:
 * no other module depends on a Spring Boot module, and core and the report modules know nothing of Spring.
 */
class DependencyDirectionTest {
    private val modules = Path.of(System.getProperty("lsd.test.modulesDir"))

    private fun buildFile(module: String): String = modules.resolve(module).resolve("build.gradle.kts").readText()

    @Test
    fun `no other module depends on a Spring Boot module`() {
        val others = modules.listDirectoryEntries().filter { it.resolve("build.gradle.kts").exists() && !it.name.startsWith("lsd-mono-spring-boot-") }
        assertTrue(others.size >= 3, "found the other modules: $others")
        for (module in others) {
            assertFalse(":modules:lsd-mono-spring-boot" in buildFile(module.name), "${module.name} depends on a Spring Boot module")
        }
    }

    @Test
    fun `core and the report modules know nothing of Spring`() {
        for (module in listOf("lsd-mono-core", "lsd-mono-report-model", "lsd-mono-report-html")) {
            val text = buildFile(module)
            assertFalse("springframework" in text || "spring-boot" in text || "spring.boot" in text, "$module mentions Spring")
        }
    }
}
