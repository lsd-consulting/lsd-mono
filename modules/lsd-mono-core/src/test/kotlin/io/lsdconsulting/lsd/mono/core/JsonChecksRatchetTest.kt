package io.lsdconsulting.lsd.mono.core

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
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/RemainingSequenceEventKindsTest.kt" to 29,
            "lsd-mono-junit-jupiter/src/test/kotlin/io/lsdconsulting/lsd/mono/junitjupiter/LsdExtensionOutcomesTest.kt" to 28,
            "lsd-mono-core/src/test/java/io/lsdconsulting/lsd/mono/core/JavaApiTest.java" to 13,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/ActivateColourAndTimestampsTest.kt" to 13,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/ConcurrentCaptureTest.kt" to 12,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/ScopedBlocksTest.kt" to 8,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/SectionCaptureTest.kt" to 8,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/UsagePingOptionTest.kt" to 8,
            "lsd-mono-report-html/src/test/kotlin/io/lsdconsulting/lsd/mono/report/html/ReportWriterTest.kt" to 5,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/MultiScenarioStatusGoldenTest.kt" to 4,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/PayloadCaptureTest.kt" to 4,
            "lsd-mono-cucumber-8/src/test/kotlin/io/lsdconsulting/lsd/mono/cucumber/LsdCucumberPluginTest.kt" to 4,
            "lsd-mono-junit-jupiter/src/test/kotlin/io/lsdconsulting/lsd/mono/junitjupiter/LsdExtensionParallelTest.kt" to 4,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/PendingCallTest.kt" to 3,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/ReportSchemaTest.kt" to 3,
            "lsd-mono-cucumber-8/src/test/kotlin/io/lsdconsulting/lsd/mono/cucumber/LsdCucumberPluginParallelTest.kt" to 3,
            "lsd-mono-report-html/src/test/kotlin/io/lsdconsulting/lsd/mono/report/html/JsonTest.kt" to 3,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/Conformance.kt" to 2,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/ScenarioParticipantsTest.kt" to 2,
            "lsd-mono-cucumber-8/src/test/kotlin/io/lsdconsulting/lsd/mono/cucumber/LsdCucumberPluginEventsTest.kt" to 2,
            "lsd-mono-report-html/src/test/kotlin/io/lsdconsulting/lsd/mono/example/adapter/AdapterReportTest.kt" to 2,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/LsdContextTest.kt" to 1,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/PayloadConvertersTest.kt" to 1,
            "lsd-mono-core/src/test/kotlin/io/lsdconsulting/lsd/mono/core/ScenarioPropagationTest.kt" to 1,
            "lsd-mono-coroutines/src/test/kotlin/io/lsdconsulting/lsd/mono/coroutines/LsdScenarioContextElementTest.kt" to 1,
            "lsd-mono-report-model/src/test/kotlin/io/lsdconsulting/lsd/mono/report/model/testing/ReportSchemasTest.kt" to 1,
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
