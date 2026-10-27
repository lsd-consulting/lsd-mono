package io.github.lsdconsulting.lsd.mono.jvm

import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString
import kotlin.io.path.isDirectory
import kotlin.io.path.readText

/**
 * Report checks read the parsed JSON (ReportJson, ScenarioJson), not substrings of the whole file
 * (#109): a substring passes when the value is anywhere in the report, and a negative one passes
 * for nothing when the spacing changes. The files still converting keep an allowance equal to their
 * current count, and the ratchet only turns one way: a new check fails here, and so does removing one
 * without lowering the allowance (or dropping the file once it reaches 0), so the slack cannot be
 * spent again later. Raw-text checks that are the point (an escaping test) stay in the allowance.
 *
 * The scan is textual: it reads every .kt and .java file under each module's src/test (not
 * src/testFixtures), so a commented-out check still counts. It spots a JSON key written as an
 * escaped or raw-string quote in contains(...), indexOf(...), Regex(...) and `"\"key\"..." in json`.
 */
class JsonChecksRatchetTest {
    /**
     * A JSON key matched as text: `json.contains("\"key": ...`, `contains(other = "{\"key\": ...`,
     * `contains(""""key": ...`, the same in `indexOf(` or `Regex(`, and `"\"key\": 1" in json`.
     */
    private val wholeFileCheck =
        Regex("""\b(?:contains|indexOf|Regex)\(\s*(?:other\s*=\s*)?(?:"\\"|"[^"\n]*\\"[^"\\\n]*\\"\s*:|""\"")|"\\"(?:[^"\\\n]|\\.)*"\s+in\s""")

    private val allowed =
        mapOf(
            "lsd-mono-report-html/src/test/kotlin/io/github/lsdconsulting/lsd/mono/report/html/JsonTest.kt" to 3,
            "lsd-mono-jvm/src/test/kotlin/io/github/lsdconsulting/lsd/mono/jvm/Conformance.kt" to 2,
            "lsd-mono-jvm/src/test/kotlin/io/github/lsdconsulting/lsd/mono/jvm/PayloadCaptureTest.kt" to 1,
            "lsd-mono-jvm/src/test/kotlin/io/github/lsdconsulting/lsd/mono/jvm/PayloadConvertersTest.kt" to 1,
            "lsd-mono-jvm/src/test/kotlin/io/github/lsdconsulting/lsd/mono/jvm/ReportSchemaTest.kt" to 1,
            "lsd-mono-report-model/src/test/kotlin/io/github/lsdconsulting/lsd/mono/report/model/testing/ReportSchemasTest.kt" to 1,
        )

    @Test
    fun `no test file adds a whole-file substring check on report JSON`() {
        val modules = Paths.get("").toAbsolutePath().parent
        val counts =
            Files
                .list(modules)
                .use { dirs -> dirs.filter { it.resolve("src/test").isDirectory() }.toList() }
                .flatMap { module ->
                    Files.walk(module.resolve("src/test")).use { files ->
                        files
                            .filter { it.extension == "kt" || it.extension == "java" }
                            .toList()
                            .map { modules.relativize(it).invariantSeparatorsPathString to count(it) }
                    }
                }.filter { it.second > 0 }
                .toMap()
        assertTrue(counts.isNotEmpty(), "found no checks at all under $modules: the scan is looking in the wrong place")
        val problems =
            (counts.keys + allowed.keys).sorted().mapNotNull { file ->
                val n = counts[file] ?: 0
                val limit = allowed[file] ?: 0
                when {
                    n > limit -> "$file has $n, over its allowance of $limit: assert on ReportJson/ScenarioJson instead"
                    n == 0 -> "$file has no checks left: drop it from the allowance"
                    n < limit -> "$file has $n, under its allowance of $limit: lower the allowance to $n"
                    else -> null
                }
            }
        assertTrue(problems.isEmpty(), "whole-file substring checks on report JSON (#109):\n" + problems.joinToString("\n"))
    }

    private fun count(file: Path): Int =
        if (file.fileName.toString() == "JsonChecksRatchetTest.kt") 0 else wholeFileCheck.findAll(file.readText()).count()
}
