package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.report.html.testing.ReportFileNames
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/** `lsd.mono.report.assets`: the context writes self-contained pages, or small ones sharing the app (#64). */
@LsdTestConfig
class ReportAssetsOptionTest {
    @TempDir
    lateinit var tempDir: Path

    private fun write(): String {
        val lsd = LsdContext()
        lsd.message("A", "B", "hello")
        lsd.completeScenario("one")
        lsd.completeReport("Assets")
        lsd.createIndex()
        return tempDir.resolve(ReportFileNames.stem("Assets") + "-diagram.html").readText()
    }

    private fun sharedFiles() = tempDir.listDirectoryEntries("lsd-report-*").map { it.name }

    @Test
    fun `pages carry the report app by default`() {
        val page = write()
        assertTrue("window.__LSD_REPORT__=" in page)
        assertEquals(emptyList<String>(), sharedFiles())
    }

    @Test
    fun `shared writes the app once and pages that load it`() {
        System.setProperty(LsdProperties.REPORT_ASSETS, "shared")
        val page = write()
        assertFalse("window.__LSD_REPORT__=" in page)
        val files = sharedFiles()
        assertEquals(2, files.size, files.toString())
        files.forEach { assertTrue("src=\"$it\"" in page || "href=\"$it\"" in page, "$it is not linked") }
        val index = tempDir.resolve("index.html").readText()
        files.forEach { assertTrue("src=\"$it\"" in index || "href=\"$it\"" in index, "$it is not linked from the index") }
    }
}
