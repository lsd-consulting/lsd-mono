package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class StudioEnvironmentTest {
    @Test
    fun `CI is on when the variable is set to something other than blank or false`() {
        assertFalse(StudioEnvironment.isCi(""))
        assertFalse(StudioEnvironment.isCi(" "))
        assertFalse(StudioEnvironment.isCi("false"))
        assertTrue(StudioEnvironment.isCi("true"))
        assertTrue(StudioEnvironment.isCi("1"))
        assertTrue(StudioEnvironment.isCi("yes"))
    }
}
