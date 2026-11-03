package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import java.net.ServerSocket

class StudioUrlWiringTest {
    @Test
    fun `the URL counts as set from a system property, an environment variable or a JVM argument`() {
        assertTrue(StudioUrlWiring.userSet(mapOf("lsd.mono.studio.url" to "x"), emptyMap(), emptyList()))
        assertTrue(StudioUrlWiring.userSet(emptyMap(), mapOf("LSD_MONO_STUDIO_URL" to "x"), emptyList()))
        assertTrue(StudioUrlWiring.userSet(emptyMap(), emptyMap(), listOf("-Dlsd.mono.studio.url=x")))
        assertTrue(StudioUrlWiring.userSet(emptyMap(), emptyMap(), listOf("-Dlsd.mono.studio.url")))
        assertFalse(StudioUrlWiring.userSet(mapOf("lsd.mono.other" to "x"), mapOf("PATH" to "x"), listOf("-Dlsd.mono.studio.urls=x")))
    }

    @Test
    fun `nothing listening is no Studio`() {
        val port = ServerSocket(0).use { it.localPort }
        assertNull(StudioUrlWiring.probe(port))
    }

    @Test
    @Timeout(10)
    fun `a listener that never answers is given up on quickly`() {
        ServerSocket(0).use { socket ->
            val started = System.nanoTime()
            assertNull(StudioUrlWiring.probe(socket.localPort))
            val millis = (System.nanoTime() - started) / 1_000_000
            assertTrue(millis < 2_000, "took $millis ms")
        }
    }
}
