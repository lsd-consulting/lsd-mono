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
 * The [LsdScenario] parameter [LsdExtension] resolves. What a completed scenario writes (title,
 * status, facts, messages) is checked on the report JSON in [LsdExtensionOutcomesTest].
 */
@ExtendWith(LsdExtension::class)
class LsdExtensionTest {
    private val lsd = LsdContext.instance

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
