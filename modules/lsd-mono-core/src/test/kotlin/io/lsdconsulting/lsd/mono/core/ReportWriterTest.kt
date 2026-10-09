package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ReportOptionsJson
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/** Direct tests for [ReportWriter] file naming, atomic writes, and the shared index (#25). */
class ReportWriterTest {

    @TempDir
    lateinit var tempDir: Path

    @Test
    fun `stems are stable, readable and differ for titles that sanitise the same`() {
        val a = ReportWriter.reportFileStem("Place an order")
        assertEquals(a, ReportWriter.reportFileStem("Place an order"), "stable across calls")
        assertTrue(Regex("""Place-an-order-[0-9a-f]{8}""").matches(a), a)
        assertNotEquals(a, ReportWriter.reportFileStem("Place-an-order"))
        assertNotEquals(a, ReportWriter.reportFileStem("Place / an order"))

        val prefix = "x".repeat(100)
        val longA = ReportWriter.reportFileStem(prefix + "A")
        val longB = ReportWriter.reportFileStem(prefix + "B")
        assertNotEquals(longA, longB, "titles that only differ after the cut")
        assertTrue(longA.length <= 80 + 9, longA)

        assertNotEquals(
            ReportWriter.reportFileStem("OrderTest", "com.a.OrderTest"),
            ReportWriter.reportFileStem("OrderTest", "com.b.OrderTest"),
        )
        assertTrue(ReportWriter.reportFileStem("***").startsWith("lsd-report-"))
        assertFalse(ReportWriter.reportFileStem("..hidden").startsWith("."))
    }

    @Test
    fun `writeReport writes its own files only and leaves no temporary files`() {
        val html = ReportWriter.writeReport(report("Orders"), tempDir.toFile())
        val stem = ReportWriter.reportFileStem("Orders")
        assertEquals("$stem-report.html", html.name)
        val names = tempDir.listDirectoryEntries().map { it.name }.toSet()
        assertEquals(setOf("$stem-report.html", "$stem-report.json", "$stem-diagram.html", ".lsd-index"), names)
        assertTrue(html.readText().contains("""href="$stem-report.json""""))
        assertTrue(tempDir.resolve("$stem-diagram.html").readText().contains("window.__LSD_REPORT__="))
    }

    @Test
    fun `a report key, when given, names the files instead of the title`() {
        val byTitle = ReportWriter.writeReport(report("Orders"), tempDir.toFile())
        val byKey = ReportWriter.writeReport(report("Orders"), tempDir.toFile(), reportKey = "com.example.OrderTest")
        assertEquals(ReportWriter.reportFileStem("Orders") + "-report.html", byTitle.name)
        assertEquals(ReportWriter.reportFileStem("Orders", "com.example.OrderTest") + "-report.html", byKey.name)
        assertNotEquals(byTitle.name, byKey.name)
    }

    @Test
    fun `concurrent writes of one report never leave a partial file`() {
        val big = report("Same", scenarioCount = 200)
        val expected = ReportWriter.writeReport(big, tempDir.toFile()).readText()
        val pool = Executors.newFixedThreadPool(8)
        val go = CountDownLatch(1)
        try {
            (1..8).map { pool.submit { go.await(); repeat(10) { ReportWriter.writeReport(big, tempDir.toFile()) } } }
                .also { go.countDown() }
                .forEach { it.get(60, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
        assertEquals(expected, tempDir.resolve(ReportWriter.reportFileStem("Same") + "-report.html").readText())
        assertTrue(tempDir.listDirectoryEntries("*.tmp").isEmpty())
    }

    @Test
    fun `an index from one writer lists reports written by others in the same directory`() {
        // Two contexts stand in for two Gradle test forks or modules sharing one output dir.
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        try {
            val forkA = LsdContext()
            val forkB = LsdContext()
            forkA.completeScenario("a")
            forkA.completeReport("Fork A")
            forkB.completeScenario("b")
            forkB.completeReport("Fork B")
            forkB.createIndex()
            val fromB = tempDir.resolve("index.html").readText()
            forkA.createIndex()
            val fromA = tempDir.resolve("index.html").readText()
            listOf(fromA, fromB).forEach { index ->
                assertTrue(index.contains("Fork A") && index.contains("Fork B"), index)
            }
            assertTrue(fromA.indexOf("Fork A") < fromA.indexOf("Fork B"), "sorted by title")
            assertFalse(fromA.contains("lsd-report.single.html"), "no shared latest link")
        } finally {
            System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-mono")
        }
    }

    @Test
    fun `index skips entries whose report was deleted and keeps explicit entries`() {
        val gone = ReportWriter.writeReport(report("Gone"), tempDir.toFile())
        ReportWriter.writeReport(report("Kept"), tempDir.toFile())
        Files.delete(gone)
        val extra = ReportFile(filename = "elsewhere.html", title = "Extra", status = "warn")
        val index = ReportWriter.writeIndex(listOf(extra), tempDir.toFile()).readText()
        assertFalse(index.contains("Gone"), index)
        assertTrue(index.contains("Kept"), index)
        assertTrue(index.contains("""<a href="elsewhere.html">Extra</a>"""), index)
    }

    @Test
    fun `index escapes titles`() {
        val index =
            ReportWriter.writeIndex(listOf(ReportFile("x.html", "<b>bold</b> & co", "success")), tempDir.toFile()).readText()
        assertTrue(index.contains("&lt;b&gt;bold&lt;/b&gt; &amp; co"), index)
    }

    private fun report(title: String, scenarioCount: Int = 0): ReportJson =
        ReportJson(
            title = title,
            generatedAt = "2026-10-09T08:00:00Z",
            generator = "test",
            status = "success",
            options = ReportOptionsJson(metricsEnabled = false, labelMaxWidth = 200),
            scenarios =
                List(scenarioCount) { n ->
                    io.lsdconsulting.lsd.mono.core.model.ScenarioJson(
                        id = "s$n",
                        title = "scenario $n",
                        status = "success",
                        description = "d".repeat(200),
                        facts = emptyList(),
                        error = null,
                        metrics = emptyList(),
                        insights = emptyList(),
                        participants = emptyList(),
                        events = emptyList(),
                    )
                },
        )
}
