package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class StudioVersionTest {
    @Test
    fun `a released plugin runs the same lsd-mono-studio version`() {
        assertEquals("lsd-mono-studio@0.17.0", StudioVersion.packageSpec(null, "0.17.0"))
    }

    @Test
    fun `an override wins`() {
        assertEquals("../lsd-mono-studio", StudioVersion.packageSpec(" ../lsd-mono-studio ", "0.17.0"))
        assertEquals("lsd-mono-studio@0.16.0", StudioVersion.packageSpec("lsd-mono-studio@0.16.0", "0.17.1-SNAPSHOT"))
    }

    @Test
    fun `a development build needs an override, and says how`() {
        val e = assertThrows<IllegalStateException> { StudioVersion.packageSpec("", "0.17.1-SNAPSHOT") }
        assertTrue(e.message!!.contains("lsd.studio.package"), e.message)
        assertTrue(e.message!!.contains("lsd-mono-studio@1.2.3"), e.message)
        assertFalse(e.message!!.contains("@latest"), "suggests a tag, which lsdStudio refuses: ${e.message}")
    }

    @Test
    fun `the plugin knows its own version`() {
        assertTrue(StudioVersion.plugin.isNotBlank() && StudioVersion.plugin != "unknown", StudioVersion.plugin)
    }
}
