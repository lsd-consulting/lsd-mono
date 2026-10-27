package io.github.lsdconsulting.lsd.mono.report.model.testing

import io.github.lsdconsulting.lsd.mono.report.model.ReportSchema
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import tools.jackson.databind.json.JsonMapper
import java.nio.file.Path
import kotlin.io.path.writeText

/** The test fixtures that put the schemas and the shared test reports on the classpath. */
class ReportSchemasTest {
    @Test
    fun `the schemas are on the classpath, at this model's schema version`() {
        ReportSchemas.Document.entries.forEach { document ->
            assertEquals(
                "https://lsd-consulting.github.io/lsd-mono/schema/${ReportSchema.VERSION}/${document.file}",
                ReportSchemas.ids.getValue(document),
            )
            assertTrue(ReportSchemas.text(document).contains("\"\$defs\""), document.file)
        }
        assertThrows(IllegalStateException::class.java) { ReportSchemas.read("no-such-schema.json") }
    }

    @Test
    fun `the corpus is on the classpath, and each report is valid or invalid as its manifest says`() {
        val manifest = MAPPER.readTree(ReportCorpus.read("manifest.json")).get("fixtures")
        val listed = (0 until manifest.size()).map { manifest.get(it) }
        assertTrue(listed.isNotEmpty())
        listed.forEach { assertTrue(ReportCorpus.has(it.get("file").asString()), it.get("file").asString()) }
        val checked =
            listed.filter { it.get("schema") != null && it.get("file").asString().endsWith(".json") }.onEach { entry ->
                val file = entry.get("file").asString()
                val document = ReportSchemas.Document.entries.single { it.file == entry.get("schema").asString() }
                val errors = ReportSchemas.errors(document, ReportCorpus.read(file))
                if (entry.get("valid")?.asBoolean() ?: true) {
                    assertEquals(emptyList<String>(), errors, file)
                } else {
                    assertTrue(errors.isNotEmpty(), "$file is meant to be rejected")
                }
            }
        assertTrue(checked.size >= 10, "checked ${checked.size} corpus files")
    }

    @Test
    fun `written output is checked against both schemas`(
        @TempDir dir: Path,
    ) {
        val report = ReportCorpus.read("reports/minimal.json")
        val index = ReportCorpus.read("indexes/status-mix.json")
        dir.resolve("a-report.json").writeText(report)
        dir.resolve("a-diagram.html").writeText("<script>window.__LSD_REPORT__=$report;</script>")
        dir.resolve("a-report.js").writeText("x({report:$report,payloadsSrc:null})")
        dir.resolve("index.html").writeText("<script>window.__LSD_INDEX__=$index;</script>")
        dir.resolve("notes.txt").writeText("not report output")
        assertEquals(4, ReportSchemas.assertOutputValid(dir))

        dir.resolve("b-report.json").writeText("""{"schemaVersion": "0.1.0"}""")
        assertThrows(AssertionError::class.java) { ReportSchemas.assertOutputValid(dir) }
    }

    @Test
    fun `output with no report in it fails`(
        @TempDir dir: Path,
    ) {
        assertThrows(AssertionError::class.java) { ReportSchemas.assertOutputValid(dir) }
        assertThrows(AssertionError::class.java) { ReportSchemas.between("abc", "x", "c") }
        assertThrows(AssertionError::class.java) { ReportSchemas.between("abc", "a", "x") }
    }

    @Test
    fun `assertValidJson accepts JSON and rejects what is not`() {
        assertValidJson("""{"a": [1, -2.5e3, true, false, null, "x\"\\\u00e9\n"], "b": {}}""")
        assertValidJson(" [ ] ")
        listOf("", "{", "[1,]", "{\"a\" 1}", "\"\\x\"", "\"\\u12\"", "01", "tru", "1 2", "{\"a\":1,}", "\"open").forEach {
            assertThrows(AssertionError::class.java, { assertValidJson(it) }, it)
        }
    }

    private companion object {
        val MAPPER: JsonMapper = JsonMapper.builder().build()
    }
}
