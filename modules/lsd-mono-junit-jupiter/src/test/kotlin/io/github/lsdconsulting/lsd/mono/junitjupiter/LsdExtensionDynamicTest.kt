package io.github.lsdconsulting.lsd.mono.junitjupiter

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.DynamicTest
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestFactory
import org.junit.jupiter.api.TestMethodOrder
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClass
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import org.opentest4j.TestAbortedException
import java.nio.file.Path
import java.util.stream.Stream

/**
 * Dynamic tests from a `@TestFactory` are recorded as their own scenarios (#238).
 * Fixture classes are not named *Test, so the Gradle suite does not run them directly.
 */
@LsdTestConfig(deterministicIds = true)
class LsdExtensionDynamicTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun setUp() {
        LsdContext.instance.clear()
    }

    @AfterEach
    fun clearContext() {
        LsdContext.instance.clear()
    }

    @Test
    fun `dynamic tests are stored as their own scenarios, not one unfinished factory`() {
        val summary = execute(DynamicFactoryFixture::class.java)

        assertEquals(4, summary.summary.testsSucceededCount.toInt(), "ordinary, passing child, two parameterised")
        assertEquals(1, summary.summary.testsFailedCount.toInt())
        assertEquals(1, summary.summary.testsAbortedCount.toInt())

        val report = reportJson("DynamicFactoryFixture")
        assertFalse(report.titles.any { it.contains("[test-factory:") }, report.titles.toString())
        assertFalse(report.scenarios.any { it.status == "warn" }, report.text)
        assertFalse(report.text.contains("Scenario was not completed before the report was written."), report.text)
        assertFalse(report.text.contains("still running"), report.text)

        val prefix = "dynamic factory fixture"
        val ordinary = report.scenario("$prefix: ordinary pass")
        assertEquals("success", ordinary.status, ordinary.json)
        assertEquals("Test passed", ordinary.description, ordinary.json)
        assertTrue("ordinary" in ordinary.labels, ordinary.json)
        assertFalse("from-passing-child" in ordinary.labels, ordinary.json)

        val passed = report.scenario("$prefix: dynamic cases: child passes")
        assertEquals("success", passed.status, passed.json)
        assertEquals("Test passed", passed.description, passed.json)
        assertTrue("from-passing-child" in passed.labels, passed.json)
        assertFalse("ordinary" in passed.labels, passed.json)

        val failed = report.scenario("$prefix: dynamic cases: child fails")
        assertEquals("error", failed.status, failed.json)
        assertEquals("Test failed", failed.description, failed.json)
        assertEquals("synthetic-child-failure", failed.error?.get("message"), failed.json)

        val aborted = report.scenario("$prefix: dynamic cases: child aborts")
        assertEquals("aborted", aborted.status, aborted.json)
        assertEquals("Test aborted", aborted.description, aborted.json)
        assertEquals("stopped early", aborted.error?.get("message"), aborted.json)

        val first = report.scenario("$prefix: each case: [1] \"one\"")
        val second = report.scenario("$prefix: each case: [2] \"two\"")
        assertEquals("success", first.status, first.json)
        assertEquals("success", second.status, second.json)
        assertTrue("one" in first.labels, first.json)
        assertTrue("two" in second.labels, second.json)
    }

    @Test
    fun `@BeforeAll captures still land on the first begun scenario when a factory runs first`() {
        execute(DynamicFactoryBeforeAllFixture::class.java)

        val report = reportJson("DynamicFactoryBeforeAllFixture")
        assertFalse(report.titles.any { it.contains("[test-factory:") }, report.titles.toString())
        assertFalse(report.scenarios.any { it.status == "warn" }, report.text)

        val first = report.scenario("dynamic factory before all fixture: cases: first child")
        val second = report.scenario("dynamic factory before all fixture: cases: second child")
        assertTrue("from-before-all" in first.labels, first.json)
        assertFalse("from-before-all" in second.labels, second.json)
        assertTrue("from-first-child" in first.labels, first.json)
        assertTrue("from-second-child" in second.labels, second.json)
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

    private fun reportJson(className: String): ReportJson = ReportJson.single(tempDir, "$className-*-report.json")
}

@Tag("lsd-fixture")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@ExtendWith(LsdExtension::class)
class DynamicFactoryFixture {
    private val lsd = LsdContext.instance

    @Test
    @Order(1)
    fun `ordinary pass`() {
        lsd.capture { "Test" calls "LsdMono" label "ordinary" }
    }

    @TestFactory
    @Order(2)
    fun dynamicCases(): Stream<DynamicTest> =
        Stream.of(
            DynamicTest.dynamicTest("child passes") {
                lsd.capture { "Test" calls "LsdMono" label "from-passing-child" }
            },
            DynamicTest.dynamicTest("child fails") {
                throw IllegalStateException("synthetic-child-failure")
            },
            DynamicTest.dynamicTest("child aborts") {
                throw TestAbortedException("stopped early")
            },
        )

    @ParameterizedTest
    @ValueSource(strings = ["one", "two"])
    @Order(3)
    fun `each case`(value: String) {
        lsd.capture { "Test" calls "LsdMono" label value }
    }
}

@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class DynamicFactoryBeforeAllFixture {
    @TestFactory
    fun cases(): Stream<DynamicTest> =
        Stream.of(
            DynamicTest.dynamicTest("first child") {
                LsdContext.instance.capture { "Test" calls "LsdMono" label "from-first-child" }
            },
            DynamicTest.dynamicTest("second child") {
                LsdContext.instance.capture { "Test" calls "LsdMono" label "from-second-child" }
            },
        )

    companion object {
        @JvmStatic
        @BeforeAll
        fun captureBeforeTests() {
            LsdContext.instance.capture { "Setup" calls "LsdMono" label "from-before-all" }
        }
    }
}
