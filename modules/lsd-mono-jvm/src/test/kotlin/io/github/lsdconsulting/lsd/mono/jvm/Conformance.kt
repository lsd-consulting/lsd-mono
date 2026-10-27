package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportCorpus
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.Assertions.assertEquals
import tools.jackson.databind.json.JsonMapper
import kotlin.io.path.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText

/**
 * The shared test reports in `modules/lsd-mono-report-schema/conformance`, which the report UI's
 * tests read too. They are read from the classpath ([ReportCorpus]), so a change to one reruns
 * these tests.
 *
 * A report lsd-mono-jvm writes for the corpus has its time and generator set to [GENERATED_AT]
 * and [GENERATOR], the only parts that change from run to run, and no usage ping ([produce]).
 * Everything else must match the corpus file byte for byte.
 */
internal object Conformance {
    const val GENERATED_AT = "2026-01-01T12:00:00Z"
    const val GENERATOR = "lsd-mono-jvm (conformance)"

    const val REPORT_SCHEMA = "lsd-report.schema.json"
    const val INDEX_SCHEMA = "lsd-index.schema.json"

    /** One entry of the corpus's `manifest.json`. */
    data class Fixture(
        val file: String,
        val schema: String?,
        val valid: Boolean,
        val source: String,
    )

    /** Every file `manifest.json` lists. */
    val fixtures: List<Fixture> by lazy {
        val entries = JsonMapper
            .builder()
            .build()
            .readTree(read("manifest.json"))
            .get("fixtures")
        (0 until entries.size()).map { i ->
            val entry = entries.get(i)
            Fixture(
                file = entry.get("file").asString(),
                schema = entry.get("schema")?.asString(),
                valid = entry.get("valid")?.asBoolean() ?: true,
                source = entry.get("source").asString(),
            )
        }
    }

    fun read(file: String): String = ReportCorpus.read(file)

    /** Settings for a report written for the corpus: no usage ping, so the page makes no request. */
    fun produce() {
        System.setProperty(LsdProperties.USAGE_PING, "false")
    }

    /** [json] with its time and generator set to the corpus's. */
    fun normalise(json: String): String =
        json
            .replace(Regex(""""generatedAt": "[^"]*""""), """"generatedAt": "$GENERATED_AT"""")
            .replace(Regex(""""generator": "[^"]*""""), """"generator": "$GENERATOR"""")

    /** [json] (a report or index manifest as written), normalised, follows [schema] and is the corpus file [file]. */
    fun assertProduced(
        file: String,
        json: String,
        schema: String = REPORT_SCHEMA,
    ) {
        val normalised = normalise(json)
        assertEquals(emptyList<String>(), errors(schema, normalised), "$file follows $schema")
        assertMatches(file, normalised)
    }

    /**
     * Fails unless [actual] is the corpus file [file], byte for byte. On a difference it writes
     * [actual] to `build/conformance-actual/<file>`, to copy over when the change is intended.
     */
    fun assertMatches(
        file: String,
        actual: String,
    ) {
        val expected = file.takeIf { ReportCorpus.has(it) }?.let { ReportCorpus.read(it) }
        if (expected != actual) {
            val out = Path("build/conformance-actual").resolve(file)
            out.parent.createDirectories()
            out.writeText(actual)
        }
        assertEquals(expected, actual, "copy build/conformance-actual/$file to modules/lsd-mono-report-schema/conformance/$file when the change is intended")
    }

    /** [json]'s errors against the schema file [schema], as `location: message` lines, formats asserted. */
    fun errors(
        schema: String,
        json: String,
    ): List<String> = ReportSchemas.errors(ReportSchemas.Document.entries.single { it.file == schema }, json)
}
