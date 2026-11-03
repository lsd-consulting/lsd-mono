package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PortInUseTest {
    @Test
    fun `the message suggests the next port, not a fixed one`() {
        val message = LsdStudioTask.portInUse(9000, "why").message!!
        assertTrue(message.contains("lsdStudio { port = 9001 }"), message)
        assertTrue(message.contains("Port 9000 is in use, and not by LSD Studio (why)"), message)
    }

    @Test
    fun `the header name matches what Studio sends`() {
        assertEquals("X-LSD-Studio", LsdStudioTask.STUDIO_HEADER)
    }
}
