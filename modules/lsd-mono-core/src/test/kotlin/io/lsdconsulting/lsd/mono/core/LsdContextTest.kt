package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
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
    fun `completeReport writes the listing json diagram and index`() {
        val lsd = LsdContext()
        lsd.addFact("framework", "junit")
        lsd.completeScenario("hello world", "<p>ok</p>", Status.SUCCESS)
        val reportPath = lsd.completeReport("Suite")
        lsd.createIndex()

        val stem = ReportWriter.reportFileStem("Suite")
        assertEquals("$stem-report.html", reportPath.fileName.toString())
        assertTrue(reportPath.toFile().exists())
        assertTrue(File(tempDir.toFile(), "$stem-report.json").exists())
        assertTrue(File(tempDir.toFile(), "$stem-diagram.html").exists())
        assertTrue(File(tempDir.toFile(), "index.html").readText().contains("$stem-report.html"))
        assertFalse(File(tempDir.toFile(), "lsd-report.single.html").exists(), "no shared latest shell")
    }

    @Test
    fun `a fixed generatedAt makes the report reproducible, and a bad one is ignored`() {
        try {
            System.setProperty(LsdProperties.GENERATED_AT, "2026-01-01T12:00:00Z")
            val lsd = LsdContext()
            lsd.completeScenario("fixed")
            lsd.completeReport("Fixed time")
            val json = File(tempDir.toFile(), "${ReportWriter.reportFileStem("Fixed time")}-report.json").readText()
            assertTrue(json.contains(""""generatedAt": "2026-01-01T12:00:00Z""""), json)

            System.setProperty(LsdProperties.GENERATED_AT, "yesterday")
            assertNull(LsdProperties.generatedAt())
        } finally {
            System.clearProperty(LsdProperties.GENERATED_AT)
        }
    }
}
