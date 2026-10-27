package io.github.lsdconsulting.lsd.mono.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class TrainVersionTest {
    @Test
    fun `before the first tag, or without git, the version is the first snapshot`() {
        assertEquals("0.0.1-SNAPSHOT", trainVersion(null, null))
        assertEquals("0.0.1-SNAPSHOT", trainVersion(null, ""))
    }

    @Test
    fun `a tagged commit builds as its tag without the v`() {
        assertEquals("0.1.0", trainVersion(null, "v0.1.0-0-g1a2b3c4\n"))
        assertEquals("0.2.0-rc.1", trainVersion(null, "v0.2.0-rc.1-0-g1a2b3c4"))
    }

    @Test
    fun `commits after a tag build as a snapshot of the next patch`() {
        assertEquals("0.1.1-SNAPSHOT", trainVersion(null, "v0.1.0-3-g1a2b3c4"))
        assertEquals("1.4.10-SNAPSHOT", trainVersion(null, "v1.4.9-12-gdeadbee"))
    }

    @Test
    fun `commits after a pre-release tag build as a snapshot of that release`() {
        assertEquals("0.2.0-SNAPSHOT", trainVersion(null, "v0.2.0-rc.1-2-g1a2b3c4"))
    }

    @Test
    fun `an explicit version wins over git`() {
        assertEquals("0.3.0", trainVersion(" 0.3.0 ", "v0.1.0-3-g1a2b3c4"))
        assertEquals("0.0.1-SNAPSHOT", trainVersion("", null))
    }

    @Test
    fun `an explicit version must be X_Y_Z without a leading v`() {
        assertThrows<IllegalArgumentException> { trainVersion("v0.3.0", null) }
        assertThrows<IllegalArgumentException> { trainVersion("0.3", null) }
        assertThrows<IllegalArgumentException> { trainVersion("01.2.3", null) }
    }

    @Test
    fun `a tag that is not a version fails the build`() {
        assertThrows<IllegalStateException> { trainVersion(null, "vnext-1-g1a2b3c4") }
    }
}
