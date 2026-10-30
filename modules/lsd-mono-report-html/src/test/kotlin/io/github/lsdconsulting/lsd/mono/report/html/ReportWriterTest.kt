package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.GeneratorJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportOptionsJson
import io.github.lsdconsulting.lsd.mono.report.model.ScenarioJson
import io.github.lsdconsulting.lsd.mono.report.model.StatusJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas.between
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFileAttributeView
import java.nio.file.attribute.PosixFilePermission
import java.time.Instant
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.writeText

/** Direct tests for [ReportWriter] file naming, atomic writes, and the shared index (#25). */
class ReportWriterTest {
    @TempDir
    lateinit var tempDir: Path

    private val writer = ReportWriter(ReportWriterSettings(generator = GeneratorJson("test")))

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
        val files = writer.writeReport(report("Orders"), tempDir)
        val stem = ReportWriter.reportFileStem("Orders")
        assertEquals("$stem-diagram.html", files.diagramHtml.name)
        assertEquals("$stem-report.json", files.reportJson.name)
        val names = tempDir.listDirectoryEntries().map { it.name }.toSet()
        assertEquals(setOf("$stem-report.json", "$stem-report.js", "$stem-diagram.html", ".lsd-index"), names)
        assertTrue(tempDir.resolve("$stem-diagram.html").readText().contains("window.__LSD_REPORT__="))
    }

    @Test
    fun `report files get the same mode as any new file, not owner-only (POSIX)`() {
        assumeTrue(Files.getFileAttributeView(tempDir, PosixFileAttributeView::class.java) != null, "POSIX file system")
        // The JVM cannot set the umask, so compare with a file created the ordinary way.
        val reference = Files.newOutputStream(tempDir.resolve("reference")).use { tempDir.resolve("reference") }
        val expected = Files.getPosixFilePermissions(reference)
        Files.delete(reference)

        val files = writer.writeReport(report("Orders"), tempDir)
        writer.writeReport(report("Orders"), tempDir) // replacing keeps the mode
        val written = listOf(files.diagramHtml, files.reportJson)
        for (file in written) assertEquals(expected, Files.getPosixFilePermissions(file), file.name)
        if (PosixFilePermission.OTHERS_READ in expected) {
            // The usual umask (022): readable by everyone, which createTempFile's 0600 was not.
            written.forEach { assertTrue(PosixFilePermission.OTHERS_READ in Files.getPosixFilePermissions(it), it.name) }
        }
    }

    @Test
    fun `a report key, when given, names the files instead of the title`() {
        val byTitle = writer.writeReport(report("Orders"), tempDir).diagramHtml
        val byKey = writer.writeReport(report("Orders"), tempDir, reportKey = "com.example.OrderTest").diagramHtml
        assertEquals(ReportWriter.reportFileStem("Orders") + "-diagram.html", byTitle.name)
        assertEquals(ReportWriter.reportFileStem("Orders", "com.example.OrderTest") + "-diagram.html", byKey.name)
        assertNotEquals(byTitle.name, byKey.name)
    }

    @Test
    fun `concurrent writes of one report never leave a partial file`() {
        val big = report("Same", scenarioCount = 200)
        val expected = writer.writeReport(big, tempDir).reportJson.readText()
        val pool = Executors.newFixedThreadPool(8)
        val go = CountDownLatch(1)
        try {
            (1..8)
                .map {
                    pool.submit {
                        go.await()
                        repeat(10) { writer.writeReport(big, tempDir) }
                    }
                }.also { go.countDown() }
                .forEach { it.get(60, TimeUnit.SECONDS) }
        } finally {
            pool.shutdownNow()
        }
        assertEquals(expected, tempDir.resolve(ReportWriter.reportFileStem("Same") + "-report.json").readText())
        assertTrue(tempDir.listDirectoryEntries("*.tmp").isEmpty())
    }

    @Test
    fun `an index from one writer lists reports written by others in the same directory`() {
        // Two writers stand in for two Gradle test forks or modules sharing one output dir.
        run {
            val forkA = ReportWriter(ReportWriterSettings(generator = GeneratorJson("fork A")))
            val forkB = ReportWriter(ReportWriterSettings(generator = GeneratorJson("fork B")))
            forkA.writeReport(report("Fork A", scenarioCount = 1), tempDir)
            forkB.writeReport(report("Fork B", scenarioCount = 1), tempDir)
            forkB.writeIndex(tempDir)
            val fromB = tempDir.resolve("index.html").readText()
            forkA.writeIndex(tempDir)
            val fromA = tempDir.resolve("index.html").readText()
            listOf(fromA, fromB).map(::manifest).forEach { index ->
                assertEquals(listOf("Fork A", "Fork B"), index.titles(), "both forks, sorted by title: $index")
            }
            assertFalse(fromA.contains("lsd-report.single.html"), "no shared latest link")
        }
    }

    @Test
    fun `index skips entries whose report was deleted and keeps explicit entries`() {
        val gone = writer.writeReport(report("Gone"), tempDir).diagramHtml
        writer.writeReport(report("Kept"), tempDir)
        Files.delete(gone)
        val extra = ReportFile(filename = "elsewhere.html", title = "Extra", status = "warn")
        val index = manifest(writer.writeIndexOf(listOf(extra), tempDir.toFile()).readText())
        assertEquals(setOf("Extra", "Kept"), index.titles().toSet(), "no Gone: $index")
        assertEquals(
            mapOf("id" to "elsewhere.html", "title" to "Extra", "status" to "warn", "href" to "elsewhere.html"),
            index.entry("Extra").filterKeys { it in setOf("id", "title", "status", "href") },
            index.source,
        )
    }

    @Test
    fun `index escapes titles`() {
        val page = writer.writeIndexOf(listOf(ReportFile("x.html", "<b>bold</b> </script> & co", "success")), tempDir.toFile()).readText()
        // The manifest's text, as the browser's HTML parser sees it: escaped, so the title cannot end the script.
        val raw = between(page, "window.__LSD_INDEX__=", ";</script>")
        assertFalse(raw.contains("</script>") || raw.contains("<b>"), raw)
        assertEquals(listOf("<b>bold</b> </script> & co"), manifest(page).titles(), "and the title reads back as it was")
    }

    @Test
    fun `index links each report to its diagram, lists failed reports first and counts scenarios`() {
        writer.writeReport(report("Alpha", scenarioCount = 2), tempDir)
        writer.writeReport(report("Zulu", scenarioCount = 3, failing = 1), tempDir)
        val page = writer.writeIndex(tempDir).readText()
        val index = manifest(page)
        val zulu = ReportWriter.reportFileStem("Zulu")
        assertEquals(listOf("Zulu", "Alpha"), index.titles(), "failed first")
        val entry = index.entry("Zulu")
        assertEquals(
            mapOf("id" to zulu, "title" to "Zulu", "status" to "error", "href" to "$zulu-diagram.html", "data" to "$zulu-report.js"),
            entry.filterKeys { it in setOf("id", "title", "status", "href", "data") },
            entry.source,
        )
        assertEquals(mapOf("success" to 2.0, "warn" to 0.0, "error" to 1.0, "skipped" to 0.0, "aborted" to 0.0), entry["counts"], entry.source)
        assertEquals(mapOf("id" to "s0", "title" to "scenario 0", "status" to "error", "messageCount" to 0.0), entry.objects("scenarios").first(), entry.source)
        assertTrue(page.contains("""name="viewport""""), "the index is the report shell")
        assertFalse(page.contains("window.__LSD_REPORT__="), "no report is embedded in the index")
    }

    @Test
    fun `each report writes a data script the index can load, and its entry lists the scenarios`() {
        writer.writeReport(report("Orders </script>", scenarioCount = 2, failing = 1), tempDir)
        val stem = ReportWriter.reportFileStem("Orders </script>")
        val data = tempDir.resolve("$stem-report.js").readText()
        assertTrue(data.startsWith("(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{})[\"$stem\"]={report:{"), data)
        assertTrue(data.trimEnd().endsWith(",payloadsSrc:null};"), data)
        assertFalse(data.contains("</script>"), "the title is escaped for a script")
        val entry = tempDir
            .resolve(".lsd-index")
            .listDirectoryEntries("*.properties")
            .single()
            .readText()
        listOf("stem=$stem", "data=$stem-report.js", "scenarios=2", "scenario.0.id=s0", "scenario.0.status=error", "scenario.1.title=scenario 1")
            .forEach { assertTrue(entry.contains(it), "$it in $entry") }
    }

    @Test
    fun `the index takes its generator, time and ping switch from the settings`() {
        val settings =
            ReportWriterSettings(generator = GeneratorJson("adapter", "1.0"), generatedAt = Instant.parse("2026-01-02T03:04:05.678Z"), usagePing = true)
        val index = manifest(ReportWriter(settings).writeIndex(tempDir).readText())
        assertEquals("2026-01-02T03:04:05.678Z", index.string("generatedAt"), index.source)
        assertEquals(mapOf("name" to "adapter", "version" to "1.0"), index.obj("generator")?.toMap(), index.source)
        assertEquals(mapOf("usagePing" to true), index["options"], index.source)
    }

    @Test
    fun `index ignores entries written by an older version`() {
        val dir = tempDir.resolve(".lsd-index")
        Files.createDirectories(dir)
        tempDir.resolve("old-report.html").writeText("old")
        dir.resolve("old-report.properties").writeText("filename=old-report.html\ntitle=Old\nstatus=success\n")
        val index = manifest(writer.writeIndex(tempDir).readText())
        assertEquals(emptyList<Any>(), index["reports"], index.source)
    }

    /**
     * The manifest the index page carries (`window.__LSD_INDEX__`), parsed (#109). [JsonObject] is the
     * test fixtures' parsed object (imported), not this package's internal one the writer renders.
     */
    private fun manifest(page: String): JsonObject = Json.parse(between(page, "window.__LSD_INDEX__=", ";</script>")) as JsonObject

    /** The manifest's report titles, in its order. */
    private fun JsonObject.titles(): List<String?> = objects("reports").map { it.string("title") }

    /** The manifest's one report titled [title]. */
    private fun JsonObject.entry(title: String): JsonObject = objects("reports").single { it.string("title") == title }

    private fun report(title: String, scenarioCount: Int = 0, failing: Int = 0): ReportJson =
        ReportJson
            .builder(
                title = title,
                generatedAt = "2026-10-09T08:00:00Z",
                generator = GeneratorJson("test"),
                status = if (failing > 0) StatusJson.ERROR else StatusJson.SUCCESS,
            ).options(
                ReportOptionsJson
                    .builder()
                    .metricsEnabled(false)
                    .labelMaxChars(200)
                    .build(),
            ).scenarios(
                List(scenarioCount) { n ->
                    ScenarioJson
                        .builder(id = "s$n", title = "scenario $n", status = if (n < failing) StatusJson.ERROR else StatusJson.SUCCESS)
                        .description("d".repeat(200))
                        .build()
                },
            ).build()
}
