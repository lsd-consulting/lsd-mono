package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class NodeVersionTest {
    @Test
    fun `reads what node --version prints`() {
        assertEquals(NodeVersion(22, 6, 0), NodeVersion.parse("v22.6.0\n"))
        assertEquals(NodeVersion(24, 11, 1), NodeVersion.parse("v24.11.1-nightly"))
        assertNull(NodeVersion.parse("command not found"))
    }

    @Test
    fun `reads a version without the v`() {
        assertEquals(NodeVersion(22, 6, 0), NodeVersion.parse("22.6.0"))
    }

    @Test
    fun `finds the version after banner lines`() {
        assertEquals(
            NodeVersion(24, 1, 0),
            NodeVersion.parse("Debugger listening on ws://127.0.0.1:9229/abc\nFor help, see: https://nodejs.org/en/docs/inspector\nv24.1.0\n"),
        )
    }

    @Test
    fun `needs all three parts`() {
        assertNull(NodeVersion.parse("v24"))
        assertNull(NodeVersion.parse("v24.1"))
        assertNull(NodeVersion.parse("node v24.1.0"))
        assertNull(NodeVersion.parse("v22.6.0abc"))
        assertNull(NodeVersion.parse("v22.6.0.1"))
        assertNull(NodeVersion.parse("v99999999999.0.0"))
    }

    @Test
    fun `a banner line that starts with numbers is not the version`() {
        assertEquals(NodeVersion(24, 1, 0), NodeVersion.parse("127.0.0.1:9229 inspector\nv24.1.0\n"))
        assertEquals(NodeVersion(24, 1, 0), NodeVersion.parse("v22.6.0.1\nv24.1.0"))
    }

    @Test
    fun `the first of several version lines wins`() {
        assertEquals(NodeVersion(24, 1, 0), NodeVersion.parse("v24.1.0\nv22.0.0"))
    }

    @Test
    fun `tolerates whitespace around the version and a suffix after it`() {
        assertEquals(NodeVersion(22, 6, 0), NodeVersion.parse("  v22.6.0\r\n"))
        assertEquals(NodeVersion(22, 6, 0), NodeVersion.parse("v22.6.0-rc.1"))
        assertEquals(NodeVersion(23, 0, 0), NodeVersion.parse("v23.0.0-nightly20240410abc"))
    }

    @Test
    fun `22_6 is the oldest that runs Studio`() {
        assertTrue(NodeVersion.parse("v22.5.1")!! < NodeVersion.MINIMUM)
        assertTrue(NodeVersion.parse("v20.19.0")!! < NodeVersion.MINIMUM)
        assertTrue(NodeVersion.parse("v22.6.0")!! >= NodeVersion.MINIMUM)
        assertTrue(NodeVersion.parse("v23.0.0")!! > NodeVersion.MINIMUM)
        assertTrue(NodeVersion.parse("v22.5.9")!! < NodeVersion.parse("v22.6.0")!!)
        assertTrue(NodeVersion.parse("v22.6.0")!! < NodeVersion.parse("v22.6.1")!!)
        assertEquals("v22.6.0", NodeVersion.MINIMUM.toString())
    }
}
