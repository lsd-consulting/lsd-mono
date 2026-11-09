package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class StudioLaunchTest {
    @Test
    fun `listens on every interface only when exposing`() {
        assertEquals("0.0.0.0", StudioLaunch.host(expose = true))
        assertEquals("127.0.0.1", StudioLaunch.host(expose = false))
    }

    @Test
    fun `builds the node command and adds expose only for every interface`() {
        assertEquals(
            listOf("node", "/tmp/studio.js", "--port", "7357"),
            StudioLaunch.command("node", "/tmp/studio.js", 7357, "127.0.0.1"),
        )
        assertEquals(
            listOf("/opt/node", "bin.js", "--port", "0", "--expose"),
            StudioLaunch.command("/opt/node", "bin.js", 0, "0.0.0.0"),
        )
        assertEquals(
            listOf("node", "bin.js", "--port", "80"),
            StudioLaunch.command("node", "bin.js", 80, "localhost"),
        )
    }

    @Test
    fun `reads the started URL and rewrites every-interface hosts for a browser`() {
        assertEquals("http://127.0.0.1:7357", StudioLaunch.startedUrl("LSD Studio on http://127.0.0.1:7357"))
        assertEquals("http://localhost:7357", StudioLaunch.startedUrl("LSD Studio on http://0.0.0.0:7357"))
        assertEquals("https://localhost:8443/path", StudioLaunch.startedUrl("ready: LSD Studio on https://0.0.0.0:8443/path"))
        assertNull(StudioLaunch.startedUrl("still starting"))
        assertNull(StudioLaunch.startedUrl("LSD Studio on not-a-url"))
    }
}
