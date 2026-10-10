package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

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

    @LsdPostTestProcessing
    private fun afterEachCapture() {
        // Exercised by the extension after the test body; keep empty for smoke coverage.
    }

    companion object {
        @JvmStatic
        @BeforeAll
        fun prepare() {
            LsdContext.instance.clear()
        }
    }
}
