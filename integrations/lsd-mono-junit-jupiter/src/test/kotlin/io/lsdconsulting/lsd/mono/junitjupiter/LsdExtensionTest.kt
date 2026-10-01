package io.lsdconsulting.lsd.mono.junitjupiter

import com.lsd.core.LsdContext
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

/**
 * Smoke test that Jupiter 6 can load [LsdExtension] and complete a successful scenario.
 * Report HTML is written by the extension's [AfterAllCallback] (after this class finishes).
 */
@ExtendWith(LsdExtension::class)
class LsdExtensionTest {

    private val lsd = LsdContext.instance

    @Test
    fun `extension completes a successful scenario`() {
        lsd.addFact("framework", "junit-jupiter-6")
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
