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
}
