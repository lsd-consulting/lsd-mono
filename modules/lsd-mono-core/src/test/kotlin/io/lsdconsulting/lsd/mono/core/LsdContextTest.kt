package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

class LsdContextTest {

    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun setOutputDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
    }

    @Test
    fun `completeReport writes html json and copies report shell`() {
        val lsd = LsdContext()
        lsd.addFact("framework", "junit")
        lsd.completeScenario("hello world", "<p>ok</p>", Status.SUCCESS)
        val reportPath = lsd.completeReport("Suite")
        lsd.createIndex()

        assertTrue(reportPath.toFile().exists())
        assertTrue(File(tempDir.toFile(), "Suite-report.json").exists() ||
            tempDir.toFile().listFiles()?.any { it.name.endsWith("-report.json") } == true)
        assertTrue(File(tempDir.toFile(), "index.html").exists())
        assertTrue(File(tempDir.toFile(), "lsd-report-next.single.html").exists())
    }

    @Test
    fun `escapeHtml encodes markup`() {
        assertTrue("&lt;b&gt;".let { "<b>".escapeHtml() == it })
    }
}
