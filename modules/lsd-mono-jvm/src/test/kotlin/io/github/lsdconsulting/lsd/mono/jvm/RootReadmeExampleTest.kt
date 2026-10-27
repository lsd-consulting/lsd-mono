package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.ACTOR
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.DATABASE
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.PARTICIPANT
import io.github.lsdconsulting.lsd.mono.jvm.domain.ParticipantType.QUEUE
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdConfig
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
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
 * The lsd-mono-jvm README's "Capture a scenario by hand" example is the [example] below, so it
 * compiles against the current API (#68). The test fails when the README block and the marked lines
 * differ, and it runs the example to check the file names the README quotes. The root README's
 * "Draw a flow without a test" `main()` is [flowExample] in the same way.
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

    private fun flowExample(): ReportFiles {
        // readme-flow:start
        val files = LsdContext.instance.report("Checkout flow") {
            scenario("Place an order") {
                capture {
                    "Customer" calls "Checkout" label "POST /orders"
                    "Checkout" calls "Payments" label "authorise card"
                    "Payments" repliesTo "Checkout" label "authorised"
                    "Checkout" sends "Order events" label "order.placed"
                    "Checkout" repliesTo "Customer" label "201 Created"
                }
            }
        }
        println("Open ${files.diagramHtml}")
        // readme-flow:end
        return files
    }

    private val readme: Path = Path.of("../../README.md")
    private val coreReadme: Path = Path.of("README.md")
    private val source: Path = Path.of("src/test/kotlin/io/github/lsdconsulting/lsd/mono/jvm/RootReadmeExampleTest.kt")

    /** The fenced Kotlin block under "## Capture a scenario by hand" in the lsd-mono-jvm README. */
    private fun readmeBlock(): List<String> =
        coreReadme
            .readLines()
            .dropWhile { it != "## Capture a scenario by hand" }
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
        val samePackage = Regex("""import io\.github\.lsdconsulting\.lsd\.mono\.jvm\.[A-Z]\w*""")
        imports
            .filterNot { samePackage.matches(it) }
            .forEach { assertTrue(it in lines, "$it is not imported here, so the README example would not compile") }
        assertEquals(body, block.drop(imports.size + 1), "copy the example between the readme markers into README.md")
    }

    /**
     * Every module the build includes is published at the train version, so docs/releasing.md and
     * modules/README.md list each one, and every count of them
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
            assertTrue("| `io.github.lsd-consulting:$module` | `modules/$module` |" in releasing, "docs/releasing.md lists $module")
            assertTrue("| `$module/` | `$module` |" in layout, "modules/README.md lists $module")
        }
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
        val text = coreReadme.readText()
        for (name in listOf(files.diagramHtml.name, files.reportJson.name, "index.html")) {
            assertTrue(tempDir.resolve(name).exists(), "$name was not written")
        }
        assertTrue(text.contains("`${files.diagramHtml.name}`"), "the README should name ${files.diagramHtml.name}")
        assertTrue(text.contains("`${files.reportJson.name}`"), "the README should name ${files.reportJson.name}")
        val payloads = files.diagramHtml.name.replace("-diagram.html", "-payloads.js")
        assertTrue(tempDir.resolve(payloads).exists() && text.contains("`$payloads`"), "the README should name $payloads")
    }

    /** The `main()` under "## Draw a flow without a test" is [flowExample], with its imports. */
    @Test
    fun `the README flow example is the compiled example`() {
        val block =
            readme
                .readLines()
                .dropWhile { it != "## Draw a flow without a test" }
                .dropWhile { it != "```kotlin" }
                .drop(1)
                .takeWhile { it != "```" }
        val imports = block.takeWhile { it.isNotBlank() }
        assertTrue(imports.all { it.startsWith("import ") }, "the README block starts with its imports: $imports")
        val samePackage = Regex("""import io\.github\.lsdconsulting\.lsd\.mono\.jvm\.[A-Z]\w*""")
        val lines = source.readLines()
        imports
            .filterNot { samePackage.matches(it) }
            .forEach { assertTrue(it in lines, "$it is not imported here, so the README example would not compile") }
        val main = block.drop(imports.size + 1)
        assertEquals("fun main() {", main.first(), "the README flow example is a main()")
        assertEquals("}", main.last(), "the README flow example is a main()")
        val body =
            lines
                .dropWhile { !it.trim().startsWith("// readme-flow:start") }
                .drop(1)
                .takeWhile { !it.trim().startsWith("// readme-flow:end") }
                .map { it.removePrefix("        ") }
        assertEquals(body, main.drop(1).dropLast(1).map { it.removePrefix("    ") }, "copy flowExample into README.md")
    }

    @Test
    fun `the flow example writes a report and the index`() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString())
        val files = flowExample()
        assertTrue(files.diagramHtml.exists(), "${files.diagramHtml} was not written")
        assertTrue(tempDir.resolve("index.html").exists(), "index.html was not written")
        assertTrue("build/reports/lsd" in readme.readText(), "the README says where the report goes")
    }
}
