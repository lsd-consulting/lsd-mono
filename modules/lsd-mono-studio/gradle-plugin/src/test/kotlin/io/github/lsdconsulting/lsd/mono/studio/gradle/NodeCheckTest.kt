package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class NodeCheckTest {
    @Test
    fun `a node that cmd cannot find is reported as not found`() {
        val e =
            assertThrows<GradleException> {
                NodeCheck.version("node", ProcessResult(9009, "'node' is not recognized as an internal or external command\r\n"))
            }
        assertTrue(e.message!!.contains("'node' failed or was not found (exit 9009: 'node' is not recognized"), e.message)
    }

    @Test
    fun `reads the version, and refuses an old or unreadable one`() {
        assertEquals(NodeVersion(24, 1, 0), NodeCheck.version("node", ProcessResult(0, "\nv24.1.0\n")))
        assertTrue(assertThrows<GradleException> { NodeCheck.version("node", ProcessResult(0, "v20.11.0")) }.message!!.contains("is v20.11.0"))
        assertTrue(assertThrows<GradleException> { NodeCheck.version("node", ProcessResult(0, "huh")) }.message!!.contains("Could not read"))
    }

    @Test
    fun `reads the version after a banner`() {
        assertEquals(
            NodeVersion(24, 1, 0),
            NodeCheck.version("node", ProcessResult(0, "Debugger listening on ws://127.0.0.1:9229/abc\nv24.1.0\n")),
        )
    }

    @Test
    fun `22_6_0 is accepted and 22_5_9 refused`() {
        assertEquals(NodeVersion(22, 6, 0), NodeCheck.version("node", ProcessResult(0, "v22.6.0")))
        val message = assertThrows<GradleException> { NodeCheck.version("node", ProcessResult(0, "v22.5.9")) }.message!!
        assertTrue(message.contains("needs Node.js v22.6.0 or newer"), message)
        assertTrue(message.contains("is v22.5.9"), message)
    }

    @Test
    fun `unreadable output is echoed, but only the start of it`() {
        val message = assertThrows<GradleException> { NodeCheck.version("node", ProcessResult(0, "x".repeat(2000))) }.message!!
        assertTrue(message.contains("x".repeat(500)), message)
        assertTrue(!message.contains("x".repeat(501)), message)
    }
}
