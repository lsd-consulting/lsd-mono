package io.lsdconsulting.lsd.mono.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class VersionAlignmentTest {
    private val cucumber = ":modules:lsd-mono-cucumber-8"
    private val junit = ":modules:lsd-mono-junit-jupiter"
    private val core = ":modules:lsd-mono-core"

    @Test
    fun `comments and blanks are no overrides`() {
        val parsed = VersionAlignment.parse(
            """
            # nothing recorded
            !also a comment

            """.trimIndent(),
        )
        assertEquals(emptyMap<String, VersionAlignment.VersionOverride>(), parsed)
    }

    @Test
    fun `module on the train passes`() {
        assertNull(VersionAlignment.alignmentFailure(core, "0.0.1-SNAPSHOT", "0.0.1-SNAPSHOT", null))
    }

    @Test
    fun `drift without an override fails`() {
        val failure = VersionAlignment.alignmentFailure(junit, "1.2.1", "1.2.0", null)
        assertTrue(failure!!.contains("train is 1.2.0"))
        assertTrue(failure.contains(junit))
    }

    @Test
    fun `cucumber patch 1_2_0 to 1_2_1 is allowed`() {
        val recorded = VersionAlignment.parse("$cucumber=patch:1.2.1")[cucumber]
        assertNull(VersionAlignment.alignmentFailure(cucumber, "1.2.1", "1.2.0", recorded))
    }

    @Test
    fun `patch must keep major and minor and raise the patch`() {
        val recorded = VersionAlignment.parse("$cucumber=patch:1.3.0")[cucumber]
        val failure = VersionAlignment.alignmentFailure(cucumber, "1.3.0", "1.2.0", recorded)
        assertTrue(failure!!.contains("keep 1.2"))
    }

    @Test
    fun `patch that is not above the train patch fails`() {
        val recorded = VersionAlignment.parse("$cucumber=patch:1.2.0")[cucumber]
        val failure = VersionAlignment.alignmentFailure(cucumber, "1.2.0", "1.2.0", recorded)
        assertTrue(failure!!.contains("Remove the line"))
    }

    @Test
    fun `junit solo 1_0_0 then 2_0_0 while the train stays 1_x`() {
        val first = VersionAlignment.parse("$junit=solo-major:1.0.0 train-major:1")[junit]
        assertNull(VersionAlignment.alignmentFailure(junit, "1.0.0", "1.4.2", first))
        val second = VersionAlignment.parse("$junit=solo-major:2.0.0 train-major:1")[junit]
        assertNull(VersionAlignment.alignmentFailure(junit, "2.0.0", "1.4.2", second))
    }

    @Test
    fun `solo 2_0_0 collapses when the train majors to 3_0_0`() {
        val recorded = VersionAlignment.parse("$junit=solo-major:2.0.0 train-major:1")[junit]
        val failure = VersionAlignment.alignmentFailure(junit, "2.0.0", "3.0.0", recorded)
        assertTrue(failure!!.contains("joins the train"))
        assertTrue(failure.contains("not added on"))
    }

    @Test
    fun `core cannot take a solo major`() {
        val recorded = VersionAlignment.parse("$core=solo-major:2.0.0 train-major:1")[core]
        val failure = VersionAlignment.alignmentFailure(core, "2.0.0", "1.4.2", recorded)
        assertTrue(failure!!.contains("cannot take a solo major"))
    }

    @Test
    fun `actual version must match the recorded override`() {
        val recorded = VersionAlignment.parse("$cucumber=patch:1.2.1")[cucumber]
        val failure = VersionAlignment.alignmentFailure(cucumber, "1.2.0", "1.2.0", recorded)
        assertTrue(failure!!.contains("recorded patch override is 1.2.1"))
    }

    @Test
    fun `solo major requires the train major it diverges from`() {
        val error = assertThrows<IllegalArgumentException> {
            VersionAlignment.parse("$junit=solo-major:2.0.0")
        }
        assertTrue(error.message!!.contains("train-major"))
    }

    @Test
    fun `snapshot patch compares the numeric patch`() {
        val recorded = VersionAlignment.parse("$core=patch:0.0.2-SNAPSHOT")[core]
        assertNull(VersionAlignment.alignmentFailure(core, "0.0.2-SNAPSHOT", "0.0.1-SNAPSHOT", recorded))
    }
}
