package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class StudioOutcomeTest {
    @Test
    fun `a Studio the task stopped is stopped, whatever its exit code`() {
        assertEquals(StudioOutcome.STOPPED, StudioOutcome.of(stopped = true, requested = true, exit = 143))
        assertEquals(StudioOutcome.STOPPED, StudioOutcome.of(stopped = true, requested = false, exit = 0))
    }

    @Test
    fun `a non-zero exit fails, even when a stop was asked for as it ended`() {
        assertEquals(StudioOutcome.FAILED, StudioOutcome.of(stopped = false, requested = true, exit = 3))
        assertEquals(StudioOutcome.FAILED, StudioOutcome.of(stopped = false, requested = false, exit = 3))
    }

    @Test
    fun `a clean exit as a stop was asked for is stopped`() {
        assertEquals(StudioOutcome.STOPPED, StudioOutcome.of(stopped = false, requested = true, exit = 0))
    }

    @Test
    fun `a clean exit nobody asked for ended on its own`() {
        assertEquals(StudioOutcome.ENDED_ON_ITS_OWN, StudioOutcome.of(stopped = false, requested = false, exit = 0))
    }
}
