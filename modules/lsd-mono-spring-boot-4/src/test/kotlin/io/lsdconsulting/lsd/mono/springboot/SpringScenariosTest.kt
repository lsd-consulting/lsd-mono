package io.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SpringScenariosTest {
    @AfterEach
    fun clearInterrupt() {
        Thread.interrupted()
    }

    @Test
    fun `a capture interrupted mid-way is dropped, and the thread stays interrupted`() {
        val result = SpringScenarios.guarded("dropped") { throw InterruptedException("stop") }

        assertEquals("dropped", result)
        assertTrue(Thread.currentThread().isInterrupted, "the interrupt is restored for whoever is waiting on it")
    }

    @Test
    fun `any other failure is dropped without interrupting the thread`() {
        val result = SpringScenarios.guarded("dropped") { error("boom") }

        assertEquals("dropped", result)
        assertFalse(Thread.currentThread().isInterrupted)
    }
}
