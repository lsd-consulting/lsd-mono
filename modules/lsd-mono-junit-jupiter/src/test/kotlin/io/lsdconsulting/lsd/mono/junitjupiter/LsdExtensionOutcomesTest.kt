package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ReportSchemas
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

        val json = reportJson("LsdOutcomeFixtures")
        assertTrue(json.contains(""""source": "junit""""), "the usage ping counts the JUnit extension")
        // Literal titles: the expected text must not come from the code that makes it (#75).
        val prefix = "lsd outcome fixtures"

        val passed = scenarioSlice(json, "$prefix: records a passing scenario")
        assertTrue(passed.contains(""""status": "success""""), passed)
        assertTrue(passed.contains(""""description": "Test passed""""), passed)
        assertTrue(passed.contains(""""label": "ping""""), passed)
        assertTrue(Regex(""""key": "framework",\s*"value": "junit-jupiter-6"""").containsMatchIn(passed), passed)
        assertTrue(passed.contains(""""label": "after-each""""), passed)
        assertFalse(passed.contains(""""error""""), passed)

        val failed = scenarioSlice(json, "$prefix: blows up with a structured failure")
        assertTrue(failed.contains(""""status": "error""""), failed)
        assertTrue(failed.contains(""""description": "Test failed""""), failed)
        assertTrue(failed.contains(""""headline": "Failed""""), failed)
        assertTrue(failed.contains(""""message": "boom: payload \u003cscript\u003e""""), failed)
        assertTrue(failed.contains(""""stack":"""), failed)
        assertTrue(failed.contains("IllegalStateException"), failed)
        assertFalse(failed.contains("overlay"), failed)
        assertFalse(failed.contains("href="), failed)
        assertFalse(failed.contains("class=\\\"error\\\""), failed)

        val disabled = scenarioSlice(json, "$prefix: is disabled")
        assertTrue(disabled.contains(""""status": "warn""""), disabled)
        assertTrue(disabled.contains(""""description": "Test disabled: not today""""), disabled)
        assertFalse(disabled.contains(""""headline""""), disabled)
        assertFalse(disabled.contains(""""label": "after-each""""), disabled)

        val aborted = scenarioSlice(json, "$prefix: aborts early")
        assertTrue(aborted.contains(""""status": "warn""""), aborted)
        assertTrue(aborted.contains(""""description": "Test aborted""""), aborted)
        assertTrue(aborted.contains(""""headline": "Test aborted""""), aborted)
        assertTrue(aborted.contains(""""message": "stopped early""""), aborted)
        assertTrue(aborted.contains(""""stack":"""), aborted)
        assertFalse(aborted.contains("overlay"), aborted)

        // A written display name keeps its case and brackets; a camelCase method name is split.
        val named = scenarioSlice(json, "$prefix: Order for iPhone (partial)")
        assertTrue(named.contains(""""status": "success""""), named)
        assertTrue(scenarioSlice(json, "$prefix: get urls for ids").contains(""""status": "success""""))

        val nested = scenarioSlice(json, "$prefix: when grouped: adds a nested scenario")
        assertTrue(nested.contains(""""status": "success""""), nested)
        assertTrue(nested.contains(""""text": "from nested""""), nested)

        assertTrue(json.contains(""""status": "error""""))
        assertFalse(Regex(""""id": "[0-9a-f]{20,}"""").containsMatchIn(json), "expected deterministic decimal ids")
    }

    @Test
    @OptIn(io.lsdconsulting.lsd.mono.core.InternalLsdApi::class)
    fun `lsd keys are read from JUnit configuration parameters`() {
        System.clearProperty(LsdProperties.HIDE_STACKTRACE)
        try {
            execute(LsdOutcomeFixtures::class.java, mapOf(LsdProperties.HIDE_STACKTRACE to "yes"))
        } finally {
            io.lsdconsulting.lsd.mono.core.properties.LsdProperties
                .useConfigurationSource(null)
        }

        val failed = scenarioSlice(reportJson("LsdOutcomeFixtures"), "lsd outcome fixtures: blows up with a structured failure")
        assertTrue(failed.contains("Displaying the stacktrace was disabled"), failed)
        assertFalse(failed.contains("at io.lsdconsulting"), failed)
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

        val json = reportJson("LsdAfterEachThrowsFixture")
        assertTrue(json.contains(""""message": "after-each broke""""), json)
        assertFalse(json.contains("InvocationTargetException"), json)
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
    private fun reportJson(className: String): String = ReportJson.single(tempDir, "$className-*-report.json").text

    /** The scenario titled [title], and only it, as written. */
    private fun scenarioSlice(json: String, title: String): String = ReportJson(json).scenario(title).json
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
