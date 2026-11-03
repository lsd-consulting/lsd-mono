package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class CommandsTest {
    private fun cmd(line: String) = listOf("cmd", "/d", "/s", "/c", line)

    @Test
    fun `on Windows anything not ending in exe goes through cmd as one quoted line`() {
        assertEquals(cmd("\"\"npm\"\""), Commands.resolve("npm", windows = true))
        assertEquals(cmd("\"\"npm.cmd\" \"install\"\""), Commands.resolve("npm.cmd", listOf("install"), windows = true))
        assertEquals(cmd("\"\"C:\\Users\\a.b\\npm\"\""), Commands.resolve("""C:\Users\a.b\npm""", windows = true))
        assertEquals(listOf("node.exe", "--version"), Commands.resolve("node.exe", listOf("--version"), windows = true))
        assertEquals(listOf("""C:\Node\NODE.EXE"""), Commands.resolve("""C:\Node\NODE.EXE""", windows = true))
    }

    @Test
    fun `a command with spaces and quoted arguments keeps every quote pair`() {
        assertEquals(
            cmd("\"\"C:\\Program Files\\nodejs\\npm.cmd\" \"install\" \"C:\\my files\\x.tgz\"\""),
            Commands.resolve("""C:\Program Files\nodejs\npm.cmd""", listOf("install", """C:\my files\x.tgz"""), windows = true),
        )
    }

    @Test
    fun `cmd characters in an argument stay inside quotes, and percent is escaped outside them`() {
        assertEquals(cmd("\"\"npm\" \"C:\\a&b|c\\x.tgz\"\""), Commands.resolve("npm", listOf("""C:\a&b|c\x.tgz"""), windows = true))
        assertEquals(cmd("\"\"npm\" \"a\"^%\"PATH\"^%\"\"\""), Commands.resolve("npm", listOf("a%PATH%"), windows = true))
        assertThrows<IllegalArgumentException> { Commands.resolve("npm", listOf("a\"b"), windows = true) }
    }

    @Test
    fun `elsewhere commands run as they are`() {
        assertEquals(listOf("npm", "a&b"), Commands.resolve("npm", listOf("a&b"), windows = false))
        assertEquals(listOf("/usr/local/bin/node"), Commands.resolve("/usr/local/bin/node", windows = false))
    }
}
