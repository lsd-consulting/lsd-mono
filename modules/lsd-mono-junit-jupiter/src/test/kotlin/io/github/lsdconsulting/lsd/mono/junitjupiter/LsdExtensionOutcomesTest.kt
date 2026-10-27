package io.github.lsdconsulting.lsd.mono.junitjupiter

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.testing.ReportSchemas
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
import org.junit.jupiter.api.DisplayName
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Nested
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.io.TempDir
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClass
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import org.opentest4j.TestAbortedException
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.readText

/**
 * Drives [LsdExtension] through the Jupiter engine so success, failure, disabled,
 * aborted, nested, and `@AfterEach` outcomes land in one report.
 * Fixture classes are not named *Test, so the Gradle suite does not run them directly.
 */
@LsdTestConfig(deterministicIds = true)
class LsdExtensionOutcomesTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun setUp() {
        System.setProperty(LsdProperties.HIDE_STACKTRACE, "false")
        LsdContext.instance.clear()
    }

    @AfterEach
    fun clearContext() {
        LsdContext.instance.clear()
    }

    @Test
    fun `what the extension writes follows the report schema`() {
        execute(LsdOutcomeFixtures::class.java)

        assertTrue(ReportSchemas.assertOutputValid(tempDir) >= 3, "the report JSON, its page and its data script")
    }

    @Test
    fun `failed test writes structured error fields`() {
        val summary = execute(LsdOutcomeFixtures::class.java)

        assertEquals(4, summary.summary.testsSucceededCount.toInt(), "success, display name, camelCase + nested")
        assertEquals(1, summary.summary.testsFailedCount.toInt())
        assertEquals(1, summary.summary.testsAbortedCount.toInt())
        assertEquals(1, summary.summary.testsSkippedCount.toInt())

        val report = reportJson("LsdOutcomeFixtures")
        assertEquals("junit", report.options["source"], "the usage ping counts the JUnit extension")
        // Literal titles: the expected text must not come from the code that makes it (#75).
        val prefix = "lsd outcome fixtures"

        val passed = report.scenario("$prefix: records a passing scenario")
        assertEquals("success", passed.status, passed.json)
        assertEquals("Test passed", passed.description, passed.json)
        assertTrue("ping" in passed.labels, passed.json)
        assertTrue(("framework" to "junit-jupiter-6") in passed.facts, passed.json)
        assertTrue("after-each" in passed.labels, passed.json)
        assertFalse(passed.obj.containsKey("error"), passed.json)

        val failed = report.scenario("$prefix: blows up with a structured failure")
        assertEquals("error", failed.status, failed.json)
        assertEquals("Test failed", failed.description, failed.json)
        val failure = failed.error ?: error("no error in ${failed.json}")
        assertEquals("Failed", failure["headline"], failed.json)
        assertEquals("boom: payload <script>", failure["message"], failed.json)
        // Raw text on purpose: the markup in the message is written escaped.
        assertTrue(failed.json.contains("""boom: payload \u003cscript\u003e"""), failed.json)
        assertTrue(failure.string("stack").orEmpty().contains("IllegalStateException"), failed.json)
        assertFalse(failed.json.contains("overlay"), failed.json)
        assertFalse(failed.json.contains("href="), failed.json)
        assertFalse(failed.json.contains("class=\\\"error\\\""), failed.json)

        val disabled = report.scenario("$prefix: is disabled")
        assertEquals("warn", disabled.status, disabled.json)
        assertEquals("Test disabled: not today", disabled.description, disabled.json)
        assertEquals(null, disabled.error?.get("headline"), disabled.json)
        assertFalse("after-each" in disabled.labels, disabled.json)

        val aborted = report.scenario("$prefix: aborts early")
        assertEquals("warn", aborted.status, aborted.json)
        assertEquals("Test aborted", aborted.description, aborted.json)
        val abort = aborted.error ?: error("no error in ${aborted.json}")
        assertEquals("Test aborted", abort["headline"], aborted.json)
        assertEquals("stopped early", abort["message"], aborted.json)
        assertTrue(abort.containsKey("stack"), aborted.json)
        assertFalse(aborted.json.contains("overlay"), aborted.json)

        // A written display name keeps its case and brackets; a camelCase method name is split.
        val named = report.scenario("$prefix: Order for iPhone (partial)")
        assertEquals("success", named.status, named.json)
        assertEquals("success", report.scenario("$prefix: get urls for ids").status)

        val nested = report.scenario("$prefix: when grouped: adds a nested scenario")
        assertEquals("success", nested.status, nested.json)
        assertEquals(listOf("from nested"), nested.eventsOf("note").map { it["text"] }, nested.json)

        assertEquals("error", report.root["status"], "the report rolls up the failure")
        val ids = report.scenarios.flatMap { scenario -> listOf(scenario["id"]) + scenario.events.map { it["id"] } }.filterNotNull()
        assertTrue(ids.isNotEmpty())
        assertFalse(ids.any { Regex("[0-9a-f]{20,}").matches(it.toString()) }, "expected deterministic decimal ids: $ids")
    }

    @Test
    @OptIn(io.github.lsdconsulting.lsd.mono.jvm.InternalLsdApi::class)
    fun `lsd keys are read from JUnit configuration parameters`() {
        System.clearProperty(LsdProperties.HIDE_STACKTRACE)
        try {
            execute(LsdOutcomeFixtures::class.java, mapOf(LsdProperties.HIDE_STACKTRACE to "yes"))
        } finally {
            io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
                .useConfigurationSource(null)
        }

        val failed = reportJson("LsdOutcomeFixtures").scenario("lsd outcome fixtures: blows up with a structured failure").json
        assertTrue(failed.contains("Displaying the stacktrace was disabled"), failed)
        assertFalse(failed.contains("at io.github.lsdconsulting"), failed)
    }

    @Test
    fun `a throwing @AfterEach method fails the test with its own exception`() {
        val summary = execute(LsdAfterEachThrowsFixture::class.java)

        assertEquals(1, summary.summary.testsFailedCount.toInt())
        val thrown = summary.summary.failures
            .single()
            .exception
        assertEquals(IllegalStateException::class.java, thrown.javaClass, thrown.stackTraceToString())
        assertEquals("after-each broke", thrown.message)

        val report = reportJson("LsdAfterEachThrowsFixture")
        assertEquals(
            "after-each broke",
            report.scenarios
                .single()
                .error
                ?.get("message"),
            report.text,
        )
        assertFalse(report.text.contains("InvocationTargetException"), report.text)
    }

    private fun execute(
        klass: Class<*>,
        configuration: Map<String, String> = emptyMap(),
    ): SummaryGeneratingListener {
        val summary = SummaryGeneratingListener()
        val request =
            LauncherDiscoveryRequestBuilder
                .request()
                .selectors(selectClass(klass))
                .configurationParameters(configuration)
                .build()
        LauncherFactory.create().execute(request, summary)
        return summary
    }

    /** One report per top-level class, named from its title plus a hash of the class id. */
    private fun reportJson(className: String): ReportJson = ReportJson.single(tempDir, "$className-*-report.json")
}

@Tag("lsd-fixture")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@ExtendWith(LsdExtension::class)
class LsdOutcomeFixtures {
    private val lsd = LsdContext.instance

    @Test
    @Order(1)
    fun `records a passing scenario`() {
        lsd.addFact("framework", "junit-jupiter-6")
        lsd.capture { "Test" calls "LsdMono" label "ping" }
    }

    @Test
    @Order(5)
    @DisplayName("Order for iPhone (partial)")
    fun displayNamed() {
        lsd.capture { "Test" calls "LsdMono" label "named" }
    }

    @Test
    @Order(6)
    fun getURLsForIDs() {
        lsd.capture { "Test" calls "LsdMono" label "camel" }
    }

    @Test
    @Order(2)
    fun `blows up with a structured failure`(): Unit = throw IllegalStateException("boom: payload <script>")

    @Test
    @Order(3)
    @Disabled("not today")
    fun `is disabled`() {
        error("should not run")
    }

    @Test
    @Order(4)
    fun `aborts early`(): Unit = throw TestAbortedException("stopped early")

    @AfterEach
    fun captureAfterBody() {
        lsd.capture { "Test" calls "LsdMono" label "after-each" }
    }

    @Tag("lsd-fixture")
    @Nested
    inner class WhenGrouped {
        @Test
        fun `adds a nested scenario`() {
            lsd.note("from nested", "Test")
        }
    }
}

@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class LsdAfterEachThrowsFixture {
    @Test
    fun `passes until after each`() {
        LsdContext.instance.capture { "Test" calls "LsdMono" label "ping" }
    }

    @AfterEach
    fun breakAfterBody(): Unit = throw IllegalStateException("after-each broke")
}
