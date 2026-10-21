package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.ACTOR
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.DATABASE
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.PARTICIPANT
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType.QUEUE
import io.lsdconsulting.lsd.mono.core.properties.LsdConfig
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.name
import kotlin.io.path.readLines
import kotlin.io.path.readText

/**
 * The root README's "Capture a scenario" example is the [example] below, so it compiles against
 * the current API (#68). The test fails when the README block and the marked lines differ, and it
 * runs the example to check the file names the README quotes.
 */
@LsdTestConfig
class RootReadmeExampleTest {
    @TempDir
    lateinit var tempDir: Path

    private fun example(): ReportFiles {
        // readme:start
        val lsd = LsdContext()
        lsd.addParticipants(
            ACTOR.called("Customer"),
            PARTICIPANT.called("Checkout"),
            DATABASE.called("Orders"),
            QUEUE.called("Order events"),
        )
        lsd.addFact("orderId", "ord-1001")
        lsd.capture {
            "Customer" calls "Checkout" label "POST /orders" data mapOf(
                "method" to "POST",
                "path" to "/orders",
                "status" to 201,
                "body" to mapOf("sku" to "SOCK-1", "qty" to 2),
            )
            activate("Checkout")
            "Checkout" calls "Orders" label "insert order"
            "Orders" repliesTo "Checkout" label "row saved"
            "Checkout" sends "Order events" label "order.placed" data mapOf(
                "orderId" to "ord-1001",
                "sku" to "SOCK-1",
            )
            "Checkout" repliesTo "Customer" label "201 Created"
            deactivate("Checkout")
        }
        lsd.completeScenario("Place an order", "Customer checks out two pairs of socks.")
        val listing = lsd.completeReport("Place an order")
        lsd.createIndex()
        // readme:end
        return listing
    }

    private val readme: Path = Path.of("../../README.md")
    private val source: Path = Path.of("src/test/kotlin/io/lsdconsulting/lsd/mono/core/RootReadmeExampleTest.kt")

    /** The fenced Kotlin block under "## Capture a scenario". */
    private fun readmeBlock(): List<String> =
        readme
            .readLines()
            .dropWhile { it != "## Capture a scenario" }
            .dropWhile { it != "```kotlin" }
            .drop(1)
            .takeWhile { it != "```" }

    @Test
    fun `the README example is the compiled example, with its imports`() {
        val lines = source.readLines()
        val body =
            lines
                .dropWhile { !it.trim().startsWith("// readme:start") }
                .drop(1)
                .takeWhile { !it.trim().startsWith("// readme:end") }
                .map { it.removePrefix("        ") }
        val block = readmeBlock()
        val imports = block.takeWhile { it.isNotBlank() }
        assertTrue(imports.all { it.startsWith("import ") }, "the README block starts with its imports: $imports")
        // A class in this test's own package needs no import here.
        val samePackage = Regex("""import io\.lsdconsulting\.lsd\.mono\.core\.[A-Z]\w*""")
        imports
            .filterNot { samePackage.matches(it) }
            .forEach { assertTrue(it in lines, "$it is not imported here, so the README example would not compile") }
        assertEquals(body, block.drop(imports.size + 1), "copy the example between the readme markers into README.md")
    }

    /**
     * The "Getting started" snippets say `X.Y.Z`, not a release: a literal version would be the previous release in
     * every tag's README, since the tag comes before any commit after it could change it (#78).
     */
    @Test
    fun `the getting started snippets name no release version`() {
        val gettingStarted =
            readme
                .readLines()
                .dropWhile { it != "## Getting started" }
                .drop(1)
                .takeWhile { !it.startsWith("## ") }
        val versions =
            gettingStarted.filter { "lsdMonoVersion =" in it || "<lsd-mono.version>" in it }
        assertEquals(2, versions.size, "the Gradle and Maven snippets each set the version once: $versions")
        assertTrue(versions.all { "X.Y.Z" in it }, "the snippets say X.Y.Z, not a release: $versions")
        val literal = Regex("""\b\d+\.\d+\.\d+\b""")
        val withVersions = gettingStarted.filter { literal.containsMatchIn(it) && "lsd-consulting" in it }
        assertTrue(withVersions.isEmpty(), "a release version in the Getting started snippets: $withVersions")
    }

    /**
     * Every module the build includes is published at the train version, so the root README's
     * artifact table, docs/releasing.md and modules/README.md list each one, and every count of them
     * in the README, releasing.md, docs/versioning-notes.md and modules/README.md is right (#78, #122).
     */
    @Test
    fun `the release docs list every published module`() {
        val modules =
            Path
                .of("../../settings.gradle.kts")
                .readLines()
                .mapNotNull { Regex("""^include\("modules:([\w-]+)"\)""").find(it.trim())?.groupValues?.get(1) }
        assertTrue(modules.size >= 6, "the modules in settings.gradle.kts: $modules")
        val count = listOf("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")[modules.size]
        val readmeText = readme.readText()
        val releasing = Path.of("../../docs/releasing.md").readText()
        val layout = Path.of("../README.md").readText()
        val versioning = Path.of("../../docs/versioning-notes.md").readText()
        modules.forEach { module ->
            assertTrue("| `$module` |" in readmeText, "the root README's artifact table lists $module")
            assertTrue("| `io.github.lsd-consulting:$module` | `modules/$module` |" in releasing, "docs/releasing.md lists $module")
            assertTrue("| `$module/` | `$module` |" in layout, "modules/README.md lists $module")
        }
        assertTrue("all $count on one version" in readmeText, "the root README says all $count on one version")
        assertTrue("one train version for all $count:" in releasing, "docs/releasing.md says all $count")
        // The docs count the artifacts one way, "all six". A digit ("all 5") or a count of the rest
        // ("the other four") would go stale unseen, so neither is allowed.
        val number = "\\d+|one|two|three|four|five|six|seven|eight|nine|ten"
        val counts = Regex("""\b(?:all|the other) (?:$number)\b""", RegexOption.IGNORE_CASE)
        val docs =
            listOf(
                "README.md" to readmeText,
                "docs/releasing.md" to releasing,
                "docs/versioning-notes.md" to versioning,
                "modules/README.md" to layout,
            )
        for ((name, text) in docs) {
            val wrong = counts
                .findAll(text)
                .map { it.value }
                .filter { it.lowercase() != "all $count" }
                .toList()
            assertTrue(wrong.isEmpty(), "$name counts the artifacts as $wrong: say all $count")
        }
    }

    @Test
    fun `the example writes the files the README names`() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString())
        val files = example()
        val text = readme.readText()
        for (name in listOf(files.diagramHtml.name, files.reportJson.name, "index.html")) {
            assertTrue(tempDir.resolve(name).exists(), "$name was not written")
        }
        assertTrue(text.contains("`${files.diagramHtml.name}`"), "the README should name ${files.diagramHtml.name}")
        assertTrue(text.contains("`${files.reportJson.name}`"), "the README should name ${files.reportJson.name}")
        val payloads = files.diagramHtml.name.replace("-diagram.html", "-payloads.js")
        assertTrue(tempDir.resolve(payloads).exists() && text.contains("`$payloads`"), "the README should name $payloads")
    }
}
