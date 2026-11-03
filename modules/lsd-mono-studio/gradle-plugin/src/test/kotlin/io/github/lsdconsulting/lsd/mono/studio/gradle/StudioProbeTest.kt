package io.github.lsdconsulting.lsd.mono.studio.gradle

import io.github.lsdconsulting.lsd.mono.studio.gradle.StudioProbe.Verdict
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files

class StudioProbeTest {
    private val url = "http://127.0.0.1:9000"

    private fun judge(
        status: Int,
        header: String?,
        expected: String? = "1.2.3",
    ) = StudioProbe.judge(url, 9000, status, header, expected)

    private fun refusal(verdict: Verdict) = assertInstanceOf(Verdict.InUse::class.java, verdict).failure.message!!

    @Test
    fun `a 200 with the expected version is reused quietly`() {
        assertEquals(Verdict.Reuse("1.2.3", null), judge(200, "1.2.3"))
        assertEquals(Verdict.Reuse("1.2.3", null), judge(200, "1.2.3", expected = null))
    }

    @Test
    fun `a 200 with another version is reused with a warning naming both`() {
        val warning = assertInstanceOf(Verdict.Reuse::class.java, judge(200, "0.16.0")).warning!!
        assertTrue(warning.contains("LSD Studio 0.16.0 is running on $url, but this build runs LSD Studio 1.2.3"), warning)
        assertTrue(warning.contains("may not line up"), warning)
    }

    @Test
    fun `only a 200 counts, even with the header`() {
        for (status in listOf(201, 204, 302, 404, 500)) {
            val message = refusal(judge(status, "1.2.3"))
            assertTrue(message.contains("LSD Studio 1.2.3 is on port 9000, but GET /api/reports answered $status"), message)
        }
    }

    @Test
    fun `a missing or empty header is not Studio, and the message says which`() {
        val missing = refusal(judge(200, null))
        assertTrue(missing.contains("An LSD Studio older than 1.2.3, or another app, is using port 9000"), missing)
        assertTrue(missing.contains("(GET /api/reports answered 200 without an X-LSD-Studio header)"), missing)
        val empty = refusal(judge(200, " "))
        assertTrue(empty.contains("(GET /api/reports answered 200 with an empty X-LSD-Studio header)"), empty)
        val unknown = refusal(judge(200, null, expected = null))
        assertTrue(unknown.contains("An older LSD Studio, or another app, is using port 9000"), unknown)
    }

    @Test
    fun `the hint suggests the next port, never past the last one`() {
        assertEquals("lsdStudio { port = 9001 }", StudioProbe.portHint(9000))
        assertEquals("lsdStudio { port = 65534 }", StudioProbe.portHint(65535))
        assertTrue(StudioProbe.portInUse(9000, "1.2.3", "why").message!!.endsWith("choose another port: lsdStudio { port = 9001 }."))
    }

    @Test
    fun `the header name matches what Studio sends`() {
        assertEquals("X-LSD-Studio", StudioProbe.STUDIO_HEADER)
    }

    @Test
    fun `the expected version is read from the package json above the script`() {
        val dir = Files.createTempDirectory("studio-probe").toFile()
        try {
            dir.resolve("bin").mkdirs()
            val script = dir.resolve("bin/lsd-mono-studio.js")
            dir.resolve("package.json").writeText("""{"version": "0.16.0"}""")
            assertEquals("0.16.0", StudioPackage.version(script))
            dir.resolve("package.json").writeText("""{"version": ""}""")
            assertNull(StudioPackage.version(script))
            dir.resolve("package.json").writeText("not json")
            assertNull(StudioPackage.version(script))
        } finally {
            dir.deleteRecursively()
        }
    }
}
