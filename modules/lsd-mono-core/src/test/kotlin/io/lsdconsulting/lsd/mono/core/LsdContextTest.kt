package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

@LsdTestConfig
class LsdContextTest {
    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `completeReport writes the json, data script, diagram and index`() {
        val lsd = LsdContext()
        lsd.addFact("framework", "junit")
        lsd.completeScenario("hello world", "<p>ok</p>", Status.SUCCESS)
        val reportPath = lsd.completeReport("Suite").diagramHtml
        lsd.createIndex()

        val stem = ReportFileNames.stem("Suite")
        assertEquals("$stem-diagram.html", reportPath.fileName.toString())
        assertTrue(reportPath.toFile().exists())
        assertTrue(File(tempDir.toFile(), "$stem-report.json").exists())
        assertTrue(File(tempDir.toFile(), "$stem-report.js").exists())
        assertFalse(File(tempDir.toFile(), "$stem-report.html").exists(), "no listing page")
        assertTrue(File(tempDir.toFile(), "index.html").readText().contains("$stem-diagram.html"))
        assertFalse(File(tempDir.toFile(), "lsd-report.single.html").exists(), "no shared latest shell")
    }

    @Test
    fun `a fixed generatedAt makes the report reproducible, and a bad one is ignored`() {
        try {
            System.setProperty(LsdProperties.GENERATED_AT, "2026-01-01T12:00:00Z")
            val lsd = LsdContext()
            lsd.completeScenario("fixed")
            lsd.completeReport("Fixed time")
            val json = ReportJson.read(tempDir.resolve("${ReportFileNames.stem("Fixed time")}-report.json"))
            assertEquals("2026-01-01T12:00:00Z", json.root["generatedAt"], json.text)

            System.setProperty(LsdProperties.GENERATED_AT, "yesterday")
            assertNull(LsdProperties.generatedAt())
        } finally {
            System.clearProperty(LsdProperties.GENERATED_AT)
        }
    }
}
