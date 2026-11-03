package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
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
    // These expect Java's default quoting, which the build uses.
    private val cmd = listOf("cmd", "/d", "/v:off", "/s", "/c", "\"")

    @Test
    fun `on Windows anything not ending in exe goes through cmd inside one outer pair of quotes`() {
        assertEquals(cmd + listOf("npm", "\""), Commands.resolve("npm", windows = true, legacy = true))
        assertEquals(cmd + listOf("npm.cmd", "install", "\""), Commands.resolve("npm.cmd", listOf("install"), windows = true, legacy = true))
        assertEquals(listOf("node.exe", "--version"), Commands.resolve("node.exe", listOf("--version"), windows = true))
        assertEquals(listOf("""C:\Node\NODE.EXE"""), Commands.resolve("""C:\Node\NODE.EXE""", windows = true))
    }

    @Test
    fun `paths with spaces stay single arguments`() {
        assertEquals(
            cmd + listOf("""C:\Program Files\nodejs\npm.cmd""", "install", """C:\my files (x86)\x.tgz""", "\""),
            Commands.resolve("""C:\Program Files\nodejs\npm.cmd""", listOf("install", """C:\my files (x86)\x.tgz"""), windows = true, legacy = true),
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
    fun `with strict Java quoting cmd gets the command and arguments without the outer quotes`() {
        assertEquals(
            listOf("cmd", "/d", "/v:off", "/c", "npm", "install"),
            Commands.resolve("npm", listOf("install"), windows = true, legacy = false),
        )
    }

    @Test
    fun `an install is checked up front, naming the setting, even for an npm exe`() {
        fun failure(npm: String, pkg: String, dir: String) =
            assertThrows<GradleException> { Commands.requireInstallSafe(npm, pkg, dir, windows = true) }.message!!
        assertTrue(
            failure(
                """C:&b
pm.cmd""",
                "lsd-mono-studio@1.0.0",
                """C:\c""",
            ).contains("(npmCommand)"),
        )
        assertTrue(failure("npm.exe", "lsd-mono-studio@^1.0", """C:\c""").contains("(the lsd-mono-studio package)"))
        assertTrue(failure("npm.exe", "lsd-mono-studio@1.0.0", """C:\R&D\c""").contains("(the install folder under cacheDir)"))
        assertDoesNotThrow {
            Commands.requireInstallSafe(
                """C:&b
pm.exe""",
                "lsd-mono-studio@1.0.0",
                """C:\c""",
                windows = true,
            )
        }
        assertDoesNotThrow { Commands.requireInstallSafe("npm", "lsd-mono-studio@^1.0", "/R&D/c", windows = false) }
    }

    @Test
    fun `a refused value with a line break is shown on one line`() {
        val e = assertThrows<GradleException> { Commands.requireCmdSafe("a\r\nb", "cacheDir", windows = true) }
        assertFalse(e.message!!.contains("\n"), e.message)
        assertTrue(e.message!!.contains("""'a\r\nb'"""), e.message)
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
