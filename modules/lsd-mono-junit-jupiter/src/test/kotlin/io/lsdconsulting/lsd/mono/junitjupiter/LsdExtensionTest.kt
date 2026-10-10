package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import kotlin.concurrent.thread

/**
 * Smoke test that Jupiter 6 can load [LsdExtension] and complete a successful scenario
 * via first-party [LsdContext] (lsd-mono-core).
 * Report HTML is written by the extension's [AfterAllCallback] (after this class finishes).
 */
@ExtendWith(LsdExtension::class)
class LsdExtensionTest {
    private val lsd = LsdContext.instance

    @Test
    fun `extension completes a successful scenario`() {
        lsd.addFact("framework", "junit-jupiter-6")
        lsd.capture { "Test" calls "LsdMono" label "ping" }
        assertTrue(true)
    }

    private var beforeEachScenario: LsdScenario? = null

    @BeforeEach
    fun rememberScenario(scenario: LsdScenario) {
        beforeEachScenario = scenario
    }

    @Test
    fun `an LsdScenario parameter is the test's own scenario`(scenario: LsdScenario) {
        assertSame(lsd.currentScenario(), scenario)
        assertSame(beforeEachScenario, scenario)
        assertTrue(scenario.isActive)
        // An unbound thread captures into the test through the parameter.
        thread { scenario.message("Worker", "LsdMono", "from another thread") }.join()
    }

    @AfterEach
    fun afterEachGetsTheSameScenario(scenario: LsdScenario) {
        assertSame(beforeEachScenario, scenario)
        assertTrue(scenario.isActive, "the scenario is completed after @AfterEach")
    }

    companion object {
        @JvmStatic
        @BeforeAll
        fun prepare() {
            LsdContext.instance.clear()
        }
    }
}
