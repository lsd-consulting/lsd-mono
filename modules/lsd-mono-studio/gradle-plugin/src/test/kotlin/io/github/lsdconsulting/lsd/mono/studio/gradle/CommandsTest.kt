package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class CommandsTest {
    @Test
    fun `on Windows anything not ending in exe goes through cmd`() {
        assertEquals(listOf("cmd", "/c", "npm"), Commands.resolve("npm", windows = true))
        assertEquals(listOf("cmd", "/c", "npm.cmd"), Commands.resolve("npm.cmd", windows = true))
        assertEquals(listOf("cmd", "/c", """C:\Users\a.b\npm"""), Commands.resolve("""C:\Users\a.b\npm""", windows = true))
        assertEquals(listOf("node.exe"), Commands.resolve("node.exe", windows = true))
        assertEquals(listOf("""C:\Node\NODE.EXE"""), Commands.resolve("""C:\Node\NODE.EXE""", windows = true))
    }

    @Test
    fun `elsewhere commands run as they are`() {
        assertEquals(listOf("npm"), Commands.resolve("npm", windows = false))
        assertEquals(listOf("/usr/local/bin/node"), Commands.resolve("/usr/local/bin/node", windows = false))
    }
}
