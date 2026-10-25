package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment

class SpringScenariosTest {
    @AfterEach
    fun clear() {
        Thread.interrupted()
        LsdContext.instance.clear()
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

    @Test
    fun `a test's client settings are held while its scenario runs and let go when it finishes`() {
        val scenario = LsdContext.instance.beginScenario(reportKey = "settings", key = "settings", bindCurrentThread = false)
        SpringScenarios.started(scenario, MockEnvironment().withProperty("spring.application.name", "shop"))

        val settings = SpringScenarios.clientSettingsOf(scenario)
        assertEquals("Shop", settings?.names?.app)
        assertSame(settings, SpringScenarios.clientSettingsOf(scenario), "resolved once per scenario")

        SpringScenarios.finished(scenario)

        assertNull(SpringScenarios.clientSettingsOf(scenario), "nothing keeps the test's context once its scenario is done")
    }

    @Test
    fun `outside a Spring test a scenario has no client settings of its own`() {
        val scenario = LsdContext.instance.beginScenario(reportKey = "plain", key = "plain", bindCurrentThread = false)
        SpringScenarios.started(scenario)
        try {
            assertNull(SpringScenarios.clientSettingsOf(scenario))
        } finally {
            SpringScenarios.finished(scenario)
        }
    }
}
