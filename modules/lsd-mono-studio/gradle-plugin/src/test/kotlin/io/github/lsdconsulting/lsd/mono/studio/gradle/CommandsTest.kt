package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class CommandsTest {
    @Test
    fun `on Windows anything not ending in exe goes through cmd, arguments kept separate`() {
        assertEquals(listOf("cmd", "/d", "/c", "npm"), Commands.resolve("npm", windows = true))
        assertEquals(listOf("cmd", "/d", "/c", "npm.cmd", "install"), Commands.resolve("npm.cmd", listOf("install"), windows = true))
        assertEquals(listOf("cmd", "/d", "/c", """C:\Users\a.b\npm"""), Commands.resolve("""C:\Users\a.b\npm""", windows = true))
        assertEquals(listOf("node.exe", "--version"), Commands.resolve("node.exe", listOf("--version"), windows = true))
        assertEquals(listOf("""C:\Node\NODE.EXE"""), Commands.resolve("""C:\Node\NODE.EXE""", windows = true))
    }

    @Test
    fun `a path with spaces is passed as one argument`() {
        assertEquals(
            listOf("cmd", "/d", "/c", """C:\Program Files\nodejs\npm.cmd""", "install", """C:\my files (x86)\x.tgz"""),
            Commands.resolve("""C:\Program Files\nodejs\npm.cmd""", listOf("install", """C:\my files (x86)\x.tgz"""), windows = true),
        )
    }

    @Test
    fun `characters cmd would act on are refused on Windows`() {
        listOf("""C:\a&b\x.tgz""", "a|b", "a%PATH%", "a\"b", "a^b", "a<b", "a>b").forEach { arg ->
            assertThrows<IllegalArgumentException>(arg) { Commands.resolve("npm", listOf(arg), windows = true) }
        }
        assertThrows<IllegalArgumentException> { Commands.resolve("""C:\a&b\npm.cmd""", windows = true) }
    }

    @Test
    fun `elsewhere commands run as they are`() {
        assertEquals(listOf("npm", "a&b"), Commands.resolve("npm", listOf("a&b"), windows = false))
        assertEquals(listOf("/usr/local/bin/node"), Commands.resolve("/usr/local/bin/node", windows = false))
    }
}
