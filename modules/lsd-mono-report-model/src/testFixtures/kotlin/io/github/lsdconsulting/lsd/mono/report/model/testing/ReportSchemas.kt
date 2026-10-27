package io.github.lsdconsulting.lsd.mono.report.model.testing

import com.networknt.schema.InputFormat
import com.networknt.schema.Schema
import com.networknt.schema.SchemaLocation
import com.networknt.schema.SchemaRegistry
import com.networknt.schema.SchemaRegistryConfig
import com.networknt.schema.SpecificationVersion
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import java.nio.file.Path
import kotlin.io.path.isRegularFile
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * The report and index JSON Schemas in `modules/lsd-mono-report-schema`, for tests that check
 * what lsd-mono writes: the core writer's, each integration module's and an adapter's. Formats
 * are asserted (2020-12 treats them as annotations by default), so a time must be a date-time.
 *
 * The schemas come from the classpath ([RESOURCES]), where these test fixtures put them, so a
 * test that uses them reruns when a schema changes, whichever module and directory it runs in.
 */
public object ReportSchemas {
    /** Where the schema directory is on the classpath: the schemas, and the corpus under `conformance/`. */
    public const val RESOURCES: String = "/lsd-mono-report-schema"

    /** What a schema describes. */
    public enum class Document(
        /** The schema's file in the schema directory. */
        public val file: String,
    ) {
        REPORT("lsd-report.schema.json"),
        INDEX("lsd-index.schema.json"),
    }

    /** The text of [path] in the schema directory, such as `lsd-report.schema.json`, read from the classpath. */
    public fun read(path: String): String =
        ReportSchemas::class.java
            .getResource("$RESOURCES/$path")
            ?.readText()
            ?: error("$RESOURCES/$path is not on the classpath: does this module's test classpath have the report-model test fixtures?")

    /** [document]'s schema, as its file has it. */
    public fun text(document: Document): String = texts.getValue(document)

    private val texts: Map<Document, String> = Document.entries.associateWith { read(it.file) }

    /** Each schema's `$id`, as its file has it. */
    public val ids: Map<Document, String> =
        texts.mapValues { (document, text) ->
            Regex(""""\${'$'}id"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1) ?: error("${document.file} has no \$id")
        }

    private val registry =
        SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12) { builder ->
            builder
                .schemaRegistryConfig(SchemaRegistryConfig.builder().formatAssertionsEnabled(true).build())
                .schemas(Document.entries.associate { ids.getValue(it) to texts.getValue(it) })
        }

    private val schemas: Map<Document, Schema> =
        Document.entries.associateWith { registry.getSchema(SchemaLocation.of(ids.getValue(it))) }

    /** [json]'s errors against [document]'s schema, as `location: message` lines. */
    public fun errors(
        document: Document,
        json: String,
    ): List<String> = schemas.getValue(document).validate(json, InputFormat.JSON).map { "${it.instanceLocation}: ${it.message}" }

    /** Fails, naming [what] and each error, unless [json] follows [document]'s schema. */
    public fun assertValid(
        document: Document,
        json: String,
        what: String,
    ) {
        assertEquals(emptyList<String>(), errors(document, json), what)
    }

    /**
     * Fails unless everything lsd-mono wrote in [dir] follows the schemas: each `*-report.json`,
     * the report in each `*-diagram.html` and `*-report.js`, and the manifest in `index.html`.
     * Returns how many documents it checked, and fails when there are none.
     */
    public fun assertOutputValid(dir: Path): Int {
        var checked = 0
        for (file in dir.listDirectoryEntries().filter { it.isRegularFile() }.sortedBy { it.name }) {
            val name = file.name
            val found =
                when {
                    name.endsWith("-report.json") -> Document.REPORT to file.readText()
                    name.endsWith("-diagram.html") -> Document.REPORT to between(file.readText(), "window.__LSD_REPORT__=", ";</script>")
                    name.endsWith("-report.js") -> Document.REPORT to between(file.readText(), "{report:", ",payloadsSrc:")
                    name == "index.html" -> Document.INDEX to between(file.readText(), "window.__LSD_INDEX__=", ";</script>")
                    else -> null
                } ?: continue
            assertValid(found.first, found.second, name)
            checked++
        }
        assertTrue(checked > 0, "no report output in $dir")
        return checked
    }

    /** The text in [text] between [start] and the next [end]. */
    public fun between(
        text: String,
        start: String,
        end: String,
    ): String {
        val from = text.indexOf(start).also { assertTrue(it >= 0, "no $start") } + start.length
        return text.substring(from, text.indexOf(end, from).also { assertTrue(it >= 0, "no $end after $start") })
    }
}
