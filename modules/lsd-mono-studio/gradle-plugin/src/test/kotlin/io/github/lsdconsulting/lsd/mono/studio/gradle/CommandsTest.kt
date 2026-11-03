package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertDoesNotThrow
import org.junit.jupiter.api.assertThrows
import org.junit.jupiter.api.condition.EnabledOnOs
import org.junit.jupiter.api.condition.OS
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.time.Duration

class CommandsTest {
    private val cmd = listOf("cmd", "/d", "/v:off", "/s", "/c", "\"")

    @Test
    fun `on Windows anything not ending in exe goes through cmd inside one outer pair of quotes`() {
        assertEquals(cmd + listOf("npm", "\""), Commands.resolve("npm", windows = true))
        assertEquals(cmd + listOf("npm.cmd", "install", "\""), Commands.resolve("npm.cmd", listOf("install"), windows = true))
        assertEquals(listOf("node.exe", "--version"), Commands.resolve("node.exe", listOf("--version"), windows = true))
        assertEquals(listOf("""C:\Node\NODE.EXE"""), Commands.resolve("""C:\Node\NODE.EXE""", windows = true))
    }

    @Test
    fun `paths with spaces stay single arguments`() {
        assertEquals(
            cmd + listOf("""C:\Program Files\nodejs\npm.cmd""", "install", """C:\my files (x86)\x.tgz""", "\""),
            Commands.resolve("""C:\Program Files\nodejs\npm.cmd""", listOf("install", """C:\my files (x86)\x.tgz"""), windows = true),
        )
    }

    @Test
    fun `characters cmd would act on are refused on Windows, naming the setting`() {
        listOf("""C:\a&b\x.tgz""", "a|b", "a%PATH%", "a\"b", "a^b", "a<b", "a>b", "a\rb", "a\nb").forEach { value ->
            val e = assertThrows<GradleException>(value) { Commands.requireCmdSafe(value, "cacheDir", windows = true) }
            assertTrue(e.message!!.contains("(cacheDir)"), e.message)
            assertThrows<GradleException>(value) { Commands.resolve("npm", listOf(value), windows = true) }
        }
        assertThrows<GradleException> { Commands.resolve("""C:\a&b\npm.cmd""", windows = true) }
        assertDoesNotThrow { Commands.requireCmdSafe("""C:\Program Files (x86)\@scope\a!b""", "cacheDir", windows = true) }
    }

    @Test
    fun `elsewhere commands run as they are`() {
        assertEquals(listOf("npm", "a&b"), Commands.resolve("npm", listOf("a&b"), windows = false))
        assertDoesNotThrow { Commands.requireCmdSafe("a&b", "cacheDir", windows = false) }
        assertEquals(listOf("/usr/local/bin/node"), Commands.resolve("/usr/local/bin/node", windows = false))
    }

    @Test
    @EnabledOnOs(OS.WINDOWS)
    fun `cmd runs a script in a folder with a space, given arguments with spaces`(
        @TempDir dir: File,
    ) {
        val folder = File(dir, "my tools").apply { mkdirs() }
        val script = File(folder, "echo args.cmd").apply { writeText("@echo off\r\necho [%~1] [%~2] [%~3]\r\n") }
        val result =
            ProcessRunner.run(
                Commands.resolve(script.path, listOf("install", """C:\my files (x86)\x.tgz""", "a!b")),
                timeout = Duration.ofSeconds(30),
            )
        assertEquals(0, result.exitCode, result.output)
        assertEquals("""[install] [C:\my files (x86)\x.tgz] [a!b]""", result.output.trim())
    }
}
