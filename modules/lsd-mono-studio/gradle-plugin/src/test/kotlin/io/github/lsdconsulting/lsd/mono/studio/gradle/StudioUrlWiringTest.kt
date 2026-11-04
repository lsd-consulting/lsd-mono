package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.testfixtures.ProjectBuilder
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.api.io.TempDir
import java.io.File
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
        assertTrue(StudioUrlWiring.probe(port, null) is StudioUrlWiring.Probe.NotRunning)
    }

    @Test
    @Timeout(10)
    fun `a listener that never answers is given up on quickly`() {
        ServerSocket(0).use { socket ->
            val started = System.nanoTime()
            assertEquals(StudioUrlWiring.Probe.NoAnswer, StudioUrlWiring.probe(socket.localPort, null))
            val millis = (System.nanoTime() - started) / 1_000_000
            assertTrue(millis < 3_000, "took $millis ms")
        }
    }

    @Test
    fun `the expected version comes from a local package, an npm version or a released plugin`(
        @TempDir dir: File,
    ) {
        dir.resolve("studio").mkdirs()
        dir.resolve("studio/package.json").writeText("""{"name":"lsd-mono-studio","version":"1.2.3"}""")
        assertEquals("1.2.3", StudioUrlWiring.expectedVersion("studio", dir))
        assertEquals("0.17.0", StudioUrlWiring.expectedVersion("lsd-mono-studio@0.17.0", dir))
        assertEquals("0.17.0-rc.1", StudioUrlWiring.expectedVersion("lsd-mono-studio@0.17.0-rc.1", dir))
        assertNull(StudioUrlWiring.expectedVersion("lsd-mono-studio@latest", dir))
        assertNull(StudioUrlWiring.expectedVersion("lsd-mono-studio@^0.17.0", dir))
        assertNull(StudioUrlWiring.expectedVersion("lsd-mono-studio@0.17", dir))
        assertNull(StudioUrlWiring.expectedVersion("lsd-mono-studio@0.17.0 - 0.18.0", dir))
        assertNull(StudioUrlWiring.expectedVersion("lsd-mono-studio@0.17.0 || 0.18.0", dir))
        assertNull(StudioUrlWiring.expectedVersion("lsd-mono-studio@0.17.0-", dir))
        assertNull(StudioUrlWiring.expectedVersion("@acme/lsd-mono-studio@0.17.0", dir))
        assertNull(StudioUrlWiring.expectedVersion("other-pkg@9.9.9", dir))
        assertNull(StudioUrlWiring.expectedVersion("./studio.tgz", dir))
        assertEquals("0.18.0", StudioUrlWiring.expectedVersion(null, dir, pluginVersion = "0.18.0"))
        assertEquals("0.18.0", StudioUrlWiring.expectedVersion(" ", dir, pluginVersion = "0.18.0"))
        assertNull(StudioUrlWiring.expectedVersion(null, dir, pluginVersion = "0.18.0-SNAPSHOT"))
    }

    @Test
    fun `a Studio answering is running, with a mismatch named when its version differs`() {
        server("HTTP/1.1 200 OK\r\nX-LSD-Studio: 0.0.1\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]") { port ->
            assertEquals(StudioUrlWiring.Probe.Running("ws://127.0.0.1:$port/ws/captures", null), StudioUrlWiring.probe(port, null))
            assertEquals(StudioUrlWiring.Probe.Running("ws://127.0.0.1:$port/ws/captures", null), StudioUrlWiring.probe(port, "0.0.1"))
            val mismatch = (StudioUrlWiring.probe(port, "1.0.0") as StudioUrlWiring.Probe.Running).mismatch
            assertEquals(
                "LSD Studio 0.0.1 is running on http://127.0.0.1:$port, but this build runs LSD Studio 1.0.0: " +
                    "tests stream to it anyway, but its live view may not line up with them.",
                mismatch,
            )
        }
    }

    @Test
    fun `an answer without the header is not running`() {
        server("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]") { port ->
            assertTrue(StudioUrlWiring.probe(port, null) is StudioUrlWiring.Probe.NotRunning)
        }
    }

    @Test
    fun `the task gets the URL only when wiring is on, not already set, and Studio answers`() {
        server("HTTP/1.1 200 OK\r\nX-LSD-Studio: 0.0.1\r\nContent-Length: 2\r\nConnection: close\r\n\r\n[]") { port ->
            val project = ProjectBuilder.builder().build()
            val test = project.tasks.register("t", org.gradle.api.tasks.testing.Test::class.java).get()

            fun wiring(
                port: Int,
                enabled: Boolean = true,
            ) = StudioUrlWiring(
                project.provider { port },
                project.provider { enabled },
                project.provider { "lsd-mono-studio@1.0.0" },
                project.projectDir,
            ).also { it.execute(test) }

            assertEquals(listOf("-Dlsd.mono.studio.url=ws://127.0.0.1:$port/ws/captures"), wiring(port).asArguments().toList())
            assertEquals(emptyList<String>(), wiring(port, enabled = false).asArguments().toList())
            assertEquals(emptyList<String>(), wiring(0).asArguments().toList())
            test.systemProperty("lsd.mono.studio.url", "ws://elsewhere")
            assertEquals(emptyList<String>(), wiring(port).asArguments().toList())
        }
    }

    /** Runs [block] with the port of a server answering every request with [response]. */
    private fun server(
        response: String,
        block: (Int) -> Unit,
    ) {
        ServerSocket(0).use { socket ->
            val thread =
                Thread {
                    runCatching {
                        while (true) {
                            socket.accept().use { client ->
                                val input = client.getInputStream()
                                var tail = 0
                                while (tail != 0x0d0a0d0a) {
                                    val b = input.read()
                                    if (b < 0) break
                                    tail = (tail shl 8) or b
                                }
                                client.getOutputStream().write(response.toByteArray())
                                client.shutdownOutput()
                            }
                        }
                    }
                }.apply {
                    isDaemon = true
                    start()
                }
            block(socket.localPort)
            thread.interrupt()
        }
    }
}
