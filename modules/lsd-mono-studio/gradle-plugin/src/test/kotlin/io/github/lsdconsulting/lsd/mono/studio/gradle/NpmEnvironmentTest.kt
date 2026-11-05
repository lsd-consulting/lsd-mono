package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

class NpmEnvironmentTest {
    @Test
    fun `turns Gradle's proxy settings into npm's proxy variables`() {
        val env =
            NpmEnvironment.of(
                mapOf(
                    "http.proxyHost" to "proxy.example",
                    "http.proxyPort" to "3128",
                    "https.proxyHost" to "secure.example",
                    "https.proxyPort" to "8443",
                    "http.nonProxyHosts" to "localhost|*.internal.example|127.0.0.1",
                ),
                existing = emptyMap(),
            )
        assertEquals("http://proxy.example:3128", env["HTTP_PROXY"])
        assertEquals("http://secure.example:8443", env["HTTPS_PROXY"])
        assertEquals("localhost,.internal.example,127.0.0.1", env["NO_PROXY"])
    }

    @Test
    fun `adds encoded credentials and default ports`() {
        val props = mapOf("https.proxyHost" to "p", "https.proxyUser" to "me@corp", "https.proxyPassword" to "p:w d")
        assertEquals("http://me%40corp:p%3Aw%20d@p:443", NpmEnvironment.proxyUrl(props, "https"))
        assertEquals("http://p:80", NpmEnvironment.proxyUrl(mapOf("http.proxyHost" to "p"), "http"))
    }

    @Test
    fun `sets nothing without a proxy host`() {
        assertTrue(NpmEnvironment.of(mapOf("http.proxyPort" to "3128", "http.nonProxyHosts" to ""), emptyMap()).isEmpty())
        assertNull(NpmEnvironment.noProxy("|"))
    }

    @Test
    fun `a blank variable counts as unset`() {
        val env = NpmEnvironment.of(mapOf("http.proxyHost" to "p"), existing = mapOf("HTTP_PROXY" to " "))
        assertEquals("http://p:80", env["HTTP_PROXY"])
    }

    @Test
    fun `variables already set win, whatever their case`() {
        val env =
            NpmEnvironment.of(
                mapOf("http.proxyHost" to "proxy.example", "https.proxyHost" to "proxy.example", "http.nonProxyHosts" to "a"),
                existing = mapOf("http_proxy" to "mine", "HTTPS_PROXY" to "mine", "NO_PROXY" to "mine"),
            )
        assertTrue(env.isEmpty(), env.toString())
    }

    @Test
    fun `puts a downloaded Node first on the PATH`() {
        val bin = File("node", "bin")
        val sep = File.pathSeparator
        assertEquals(bin.path + sep + "/usr/bin", NpmEnvironment.of(emptyMap(), mapOf("PATH" to "/usr/bin"), bin, windows = false)["PATH"])
        assertEquals(bin.path, NpmEnvironment.of(emptyMap(), emptyMap(), bin, windows = false)["PATH"])
        val windows = NpmEnvironment.of(emptyMap(), mapOf("Path" to "C:\\w"), bin, windows = true)
        assertEquals(bin.path + sep + "C:\\w", windows["Path"])
    }

    @Test
    fun `a proxy user without a password has no colon, and a password without a user is dropped`() {
        assertEquals("http://me@p:443", NpmEnvironment.proxyUrl(mapOf("https.proxyHost" to "p", "https.proxyUser" to "me"), "https"))
        assertEquals("http://p:443", NpmEnvironment.proxyUrl(mapOf("https.proxyHost" to "p", "https.proxyPassword" to "pw"), "https"))
    }
}
