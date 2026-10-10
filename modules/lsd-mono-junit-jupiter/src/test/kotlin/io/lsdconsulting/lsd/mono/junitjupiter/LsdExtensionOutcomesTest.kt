package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Disabled
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
 * aborted, nested, and post-processing outcomes land in one report.
 * Fixture classes are not named *Test, so the Gradle suite does not run them directly.
 */
class LsdExtensionOutcomesTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        System.setProperty("lsd.mono.ids.deterministic", "true")
        System.setProperty("lsd.mono.junit.hideStacktrace", "false")
        LsdContext.instance.clear()
    }

    @AfterEach
    fun restoreOutputDir() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
        System.clearProperty("lsd.mono.ids.deterministic")
        System.clearProperty("lsd.mono.junit.hideStacktrace")
        LsdContext.instance.clear()
    }

    @Test
    fun `failed test writes structured error fields`() {
        val summary = execute(LsdOutcomeFixtures::class.java)

        assertEquals(2, summary.summary.testsSucceededCount.toInt(), "success + nested")
        assertEquals(1, summary.summary.testsFailedCount.toInt())
        assertEquals(1, summary.summary.testsAbortedCount.toInt())
        assertEquals(1, summary.summary.testsSkippedCount.toInt())

        val json = reportJson("LsdOutcomeFixtures")
        val prefix = "LsdOutcomeFixtures".deCamelCase()

        val passed = scenarioSlice(json, "$prefix: records a passing scenario")
        assertTrue(passed.contains(""""status": "success""""), passed)
        assertTrue(passed.contains(""""description": "Test passed""""), passed)
        assertTrue(passed.contains(""""label": "ping""""), passed)
        assertTrue(passed.contains(""""label": "post-processing""""), passed)
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
        assertFalse(disabled.contains(""""label": "post-processing""""), disabled)

        val aborted = scenarioSlice(json, "$prefix: aborts early")
        assertTrue(aborted.contains(""""status": "warn""""), aborted)
        assertTrue(aborted.contains(""""description": "Test aborted""""), aborted)
        assertTrue(aborted.contains(""""headline": "Test aborted""""), aborted)
        assertTrue(aborted.contains(""""message": "stopped early""""), aborted)
        assertTrue(aborted.contains(""""stack":"""), aborted)
        assertFalse(aborted.contains("overlay"), aborted)

        val nested = scenarioSlice(json, "$prefix: ${"WhenGrouped".deCamelCase()}: adds a nested scenario")
        assertTrue(nested.contains(""""status": "success""""), nested)
        assertTrue(nested.contains(""""text": "from nested""""), nested)

        assertTrue(json.contains(""""status": "error""""))
        assertFalse(Regex(""""id": "[0-9a-f]{20,}"""").containsMatchIn(json), "expected deterministic decimal ids")
    }

    @Test
    fun `a throwing post-processing method fails the test with its own exception`() {
        val summary = execute(LsdPostProcessingThrowsFixture::class.java)

        assertEquals(1, summary.summary.testsFailedCount.toInt())
        val thrown = summary.summary.failures
            .single()
            .exception
        assertEquals(IllegalStateException::class.java, thrown.javaClass, thrown.stackTraceToString())
        assertEquals("post-processing broke", thrown.message)

        val json = reportJson("LsdPostProcessingThrowsFixture")
        assertTrue(json.contains(""""message": "post-processing broke""""), json)
        assertFalse(json.contains("InvocationTargetException"), json)
    }

    private fun execute(klass: Class<*>): SummaryGeneratingListener {
        val summary = SummaryGeneratingListener()
        val request =
            LauncherDiscoveryRequestBuilder
                .request()
                .selectors(selectClass(klass))
                .build()
        LauncherFactory.create().execute(request, summary)
        return summary
    }

    /** One report per top-level class, named from its title plus a hash of the class id. */
    private fun reportJson(className: String): String {
        val files = tempDir.listDirectoryEntries("$className-*-report.json")
        assertEquals(1, files.size, "expected one report for $className in ${tempDir.listDirectoryEntries()}")
        return files.single().readText()
    }

    private fun scenarioSlice(json: String, title: String): String {
        val key = """"title": "$title""""
        val start = json.indexOf(key)
        assertTrue(start >= 0, "missing scenario '$title' in $json")
        val next = json.indexOf("\"title\": \"", start + key.length)
        return if (next < 0) json.substring(start) else json.substring(start, next)
    }
}

@Tag("lsd-fixture")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@ExtendWith(LsdExtension::class)
class LsdOutcomeFixtures {
    private val lsd = LsdContext.instance

    @Test
    @Order(1)
    fun `records a passing scenario`() {
        lsd.capture { "Test" calls "LsdMono" label "ping" }
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

    @LsdPostTestProcessing
    private fun captureAfterBody() {
        lsd.capture { "Test" calls "LsdMono" label "post-processing" }
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
class LsdPostProcessingThrowsFixture {
    @Test
    fun `passes until post-processing`() {
        LsdContext.instance.capture { "Test" calls "LsdMono" label "ping" }
    }

    @LsdPostTestProcessing
    private fun breakAfterBody(): Unit = throw IllegalStateException("post-processing broke")
}
