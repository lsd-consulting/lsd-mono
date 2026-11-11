package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.GeneratorJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.StatusJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.io.path.writeText

/** [ReportAssets.SHARED]: one copy of the report app per directory, small pages that load it (#64). */
class SharedAssetsTest {
    @TempDir
    lateinit var tempDir: Path

    private val generator = GeneratorJson("test")
    private val shared = ReportWriter(ReportWriterSettings(generator, null, true, ReportAssets.SHARED))

    private fun assetNames() = tempDir.listDirectoryEntries("lsd-report-*").map { it.name }.sorted()

    @Test
    fun `the default writes self-contained pages and no shared files`() {
        val settings = ReportWriterSettings(generator)
        assertEquals(ReportAssets.INLINE, settings.assets)
        ReportWriter(settings).writeReport(report("Orders"), tempDir)
        ReportWriter(settings).writeIndex(tempDir)
        assertEquals(emptyList<String>(), assetNames())
        val stem = ReportWriter.reportFileStem("Orders")
        assertTrue("window.__LSD_REPORT__=" in tempDir.resolve("$stem-diagram.html").readText())
    }

    @Test
    fun `a shared page names its report and loads its data, then the app, from files beside it`() {
        val files = shared.writeReport(report("Orders"), tempDir)
        val stem = ReportWriter.reportFileStem("Orders")
        val names = assetNames()
        assertEquals(2, names.size, names.toString())
        val script = names.single { it.endsWith(".js") }
        val styles = names.single { it.endsWith(".css") }
        assertTrue(Regex("""lsd-report-[0-9a-f]{16}\.js""").matches(script), script)
        assertTrue(Regex("""lsd-report-[0-9a-f]{16}\.css""").matches(styles), styles)

        val page = files.diagramHtml.readText()
        val head = page.substringBefore("</head>")
        assertTrue("""<meta name="lsd-report" content="$stem" />""" in head, page)
        assertTrue("""<link rel="stylesheet" href="$styles" />""" in head, page)
        val data = page.indexOf("""<script src="$stem-report.js"></script>""")
        val app = page.indexOf("""<script src="$script"></script>""")
        assertTrue(data in 0 until app, page)
        assertFalse("__LSD_REPORT__=" in page, "no report data in the page")
        assertTrue(page.length < 4_000, "page is ${page.length} chars")

        assertTrue("window.__LSD_REPORT__??" in tempDir.resolve(script).readText())
        val dataScript = tempDir.resolve("$stem-report.js").readText()
        assertTrue(dataScript.startsWith("(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{})[\"$stem\"]={report:{"), dataScript)
        assertEquals(files.reportJson.readText(), ReportWriter.toJson(report("Orders")))
    }

    @Test
    fun `every page and the index in a directory share one copy`() {
        shared.writeReport(report("Orders"), tempDir)
        val first = assetNames()
        shared.writeReport(report("Refunds"), tempDir)
        shared.writeReport(report("Orders"), tempDir)
        val index = shared.writeIndex(tempDir).readText()
        assertEquals(first, assetNames())
        val script = first.single { it.endsWith(".js") }
        assertTrue("""<script src="$script"></script>""" in index, index)
        assertTrue("window.__LSD_INDEX__=" in index)
        assertFalse("<meta name=\"lsd-report\"" in index)
        assertTrue(index.length < 8_000, "index is ${index.length} chars")
        assertTrue(index.indexOf("window.__LSD_INDEX__=") < index.indexOf("""<script src="$script">"""))
    }

    @Test
    fun `an index written alone still writes the shared files it loads`() {
        shared.writeIndex(tempDir)
        assertEquals(2, assetNames().size, assetNames().toString())
    }

    @Test
    fun `another version's files are left beside this one's`() {
        val other = tempDir.resolve("lsd-report-0123456789abcdef.js").also { it.writeText("other version") }
        shared.writeReport(report("Orders"), tempDir)
        assertTrue(other.exists())
        assertEquals("other version", other.readText())
        assertEquals(3, assetNames().size)
    }

    @Test
    fun `a shared file cut short or edited is written again, a whole one is left alone`() {
        shared.writeReport(report("Orders"), tempDir)
        val script = tempDir.resolve(assetNames().single { it.endsWith(".js") })
        val whole = script.readText()
        script.writeText(whole.take(100))
        shared.writeReport(report("Orders"), tempDir)
        assertEquals(whole, script.readText(), "rewritten in full")

        val modified = Files.getLastModifiedTime(script)
        Thread.sleep(20)
        shared.writeIndex(tempDir)
        assertEquals(modified, Files.getLastModifiedTime(script), "not written again")
        assertEquals(emptyList<String>(), tempDir.listDirectoryEntries(".*.tmp").map { it.name })
    }

    @Test
    fun `a move that fails onto a file already there in full is fine, otherwise it fails`() {
        val asset = SharedAssets.packaged.styles
        // A directory of the asset's name: the move onto it fails as it can on Windows.
        val blocked = tempDir.resolve(asset.name).also { Files.createDirectory(it) }
        Files.writeString(blocked.resolve("x"), "x")
        assertThrows(java.nio.file.FileSystemException::class.java) { shared.writeSharedAsset(blocked, asset) }

        val whole = tempDir.resolve("whole.css")
        Files.writeString(whole, asset.text)
        shared.writeSharedAsset(whole, asset) // already there: nothing to do
        assertEquals(asset.text, whole.readText())
    }

    @Test
    fun `a file name is the hash of its content`() {
        val a = SharedAssets.contentHash("a")
        assertEquals(16, a.length)
        assertEquals(a, SharedAssets.contentHash("a"))
        assertNotEquals(a, SharedAssets.contentHash("b"))
        val packaged = SharedAssets.packaged
        assertEquals("lsd-report-${SharedAssets.contentHash(packaged.script.text)}.js", packaged.script.name)
    }

    @Test
    fun `settings compare and print their assets`() {
        val inline = ReportWriterSettings(generator, null, true)
        val explicit = ReportWriterSettings(generator, null, true, ReportAssets.INLINE)
        val sharedSettings = ReportWriterSettings(generator, null, true, ReportAssets.SHARED)
        assertEquals(inline, explicit)
        assertNotEquals(inline, sharedSettings)
        assertTrue("assets=SHARED" in sharedSettings.toString(), sharedSettings.toString())
    }

    private fun report(title: String): ReportJson =
        ReportJson
            .builder(title = title, generatedAt = "2026-10-09T08:00:00Z", generator = generator, status = StatusJson.SUCCESS)
            .build()
}
