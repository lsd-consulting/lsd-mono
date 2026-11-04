package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import java.io.File

class NpmInstallTest {
    private val target = File("cache", "tmp")

    @Test
    fun `passes --offline to npm only when Gradle is offline`() {
        assertTrue("--offline" !in NpmInstall.args(target, SPEC, offline = false))
        val args = NpmInstall.args(target, SPEC, offline = true)
        assertTrue("--offline" in args)
        assertEquals(SPEC, args.last())
    }

    @Test
    fun `explains a cache miss when offline`() {
        val e =
            assertThrows<GradleException> {
                NpmInstall.explainOfflineMiss(true, SPEC) { throw GradleException("npm error code ENOTCACHED") }
            }
        assertTrue(e.message!!.contains("--offline"), e.message)
        assertTrue(e.message!!.contains(SPEC), e.message)
    }

    @Test
    fun `leaves other failures alone`() {
        val online = GradleException("npm error code ENOTCACHED")
        assertSame(online, assertThrows<GradleException> { NpmInstall.explainOfflineMiss(false, SPEC) { throw online } })
        val other = GradleException("npm error code E404")
        assertSame(other, assertThrows<GradleException> { NpmInstall.explainOfflineMiss(true, SPEC) { throw other } })
        assertEquals(1, NpmInstall.explainOfflineMiss(true, SPEC) { 1 })
    }

    private companion object {
        const val SPEC = "lsd-mono-studio@1.2.3"
    }
}
