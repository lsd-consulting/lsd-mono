package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.io.File

class NodeLayoutTest {
    private val dir = File("node-v22")

    @Test
    fun `node and npm are under bin outside Windows`() {
        val bin = NodeLayout.binDir(dir, windows = false)
        assertEquals(dir.resolve("bin"), bin)
        assertEquals(bin.resolve("node"), NodeLayout.node(bin, windows = false))
        assertEquals(bin.resolve("npm"), NodeLayout.npm(bin, windows = false))
    }

    @Test
    fun `node exe and npm cmd are at the top on Windows`() {
        val bin = NodeLayout.binDir(dir, windows = true)
        assertEquals(dir, bin)
        assertEquals(dir.resolve("node.exe"), NodeLayout.node(bin, windows = true))
        assertEquals(dir.resolve("npm.cmd"), NodeLayout.npm(bin, windows = true))
    }
}
