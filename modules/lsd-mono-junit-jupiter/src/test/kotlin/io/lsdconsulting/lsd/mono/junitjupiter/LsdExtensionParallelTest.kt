package io.lsdconsulting.lsd.mono.junitjupiter

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.io.TempDir
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClass
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import java.nio.file.Path
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/**
 * Runs two fixture classes with JUnit Jupiter parallel execution (classes and methods
 * concurrent, four threads) and checks every report holds only its own scenarios, and
 * every scenario only its own messages and facts (#24, #25).
 */
class LsdExtensionParallelTest {
    @TempDir
    lateinit var tempDir: Path

    @BeforeEach
    fun pointReportsAtTempDir() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        LsdContext.instance.clear()
        ParallelFixtureState.reset()
    }

    @AfterEach
    fun restoreOutputDir() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
        LsdContext.instance.clear()
    }

    @Test
    fun `parallel tests and classes each get only their own events`() {
        val summary = SummaryGeneratingListener()
        val request =
            LauncherDiscoveryRequestBuilder
                .request()
                .selectors(selectClass(ParallelFixtureA::class.java), selectClass(ParallelFixtureB::class.java))
                .configurationParameter("junit.jupiter.execution.parallel.enabled", "true")
                .configurationParameter("junit.jupiter.execution.parallel.mode.default", "concurrent")
                .configurationParameter("junit.jupiter.execution.parallel.mode.classes.default", "concurrent")
                .configurationParameter("junit.jupiter.execution.parallel.config.strategy", "fixed")
                .configurationParameter("junit.jupiter.execution.parallel.config.fixed.parallelism", "4")
                .build()
        LauncherFactory.create().execute(request, summary)

        assertEquals(0, summary.summary.testsFailedCount.toInt(), summary.summary.failures.joinToString { it.exception.stackTraceToString() })
        assertEquals(2 * TESTS_PER_CLASS, summary.summary.testsSucceededCount.toInt())
        assertTrue(ParallelFixtureState.maxInFlight.get() > 1, "fixtures did not overlap, so this run proves nothing")

        listOf("ParallelFixtureA" to "a", "ParallelFixtureB" to "b").forEach { (className, tag) ->
            val json = reportJson(className)
            val titles = Regex(""""title": "parallel fixture [ab]: test(\d+)"""").findAll(json).map { it.value }.toList()
            assertEquals(TESTS_PER_CLASS, titles.size, "$className report should hold exactly its own $TESTS_PER_CLASS scenarios: $titles")
            assertTrue(titles.all { it.contains("parallel fixture $tag:") }, "$className report holds another class's scenarios: $titles")
            (1..TESTS_PER_CLASS).forEach { n ->
                val own = "$tag$n"
                val slice = scenarioSlice(json, "parallel fixture $tag: test$n")
                val labels = Regex(""""label": "([a-z]\d+)-\d+"""").findAll(slice).map { it.groupValues[1] }.toList()
                assertEquals(MESSAGES_PER_TEST, labels.size, "$own should have $MESSAGES_PER_TEST messages, had ${labels.size}")
                assertTrue(labels.all { it == own }, "$own has messages from ${labels.toSet() - own}")
                val facts = Regex(""""key": "test",\s*"value": "([a-z]\d+)"""").findAll(slice).map { it.groupValues[1] }.toList()
                assertEquals(listOf(own), facts, "$own facts")
            }
        }
    }

    @Test
    fun `injected scenarios capture into their own test from unbound threads, in parallel`() {
        val summary = SummaryGeneratingListener()
        val request =
            LauncherDiscoveryRequestBuilder
                .request()
                .selectors(selectClass(ParallelInjectedFixture::class.java))
                .configurationParameter("junit.jupiter.execution.parallel.enabled", "true")
                .configurationParameter("junit.jupiter.execution.parallel.mode.default", "concurrent")
                .configurationParameter("junit.jupiter.execution.parallel.config.strategy", "fixed")
                .configurationParameter("junit.jupiter.execution.parallel.config.fixed.parallelism", "4")
                .build()
        LauncherFactory.create().execute(request, summary)

        assertEquals(0, summary.summary.testsFailedCount.toInt(), summary.summary.failures.joinToString { it.exception.stackTraceToString() })
        assertEquals(TESTS_PER_CLASS, summary.summary.testsSucceededCount.toInt())
        assertTrue(ParallelFixtureState.maxInFlight.get() > 1, "fixtures did not overlap, so this run proves nothing")
        val json = reportJson("ParallelInjectedFixture")
        (1..TESTS_PER_CLASS).forEach { n ->
            val slice = scenarioSlice(json, "parallel injected fixture: test$n")
            val labels = Regex(""""label": "([a-z]\d+)-\d+"""").findAll(slice).map { it.groupValues[1] }.toList()
            assertEquals(List(MESSAGES_PER_TEST) { "i$n" }, labels, "i$n")
        }
    }

    private fun reportJson(className: String): String {
        val files = tempDir.listDirectoryEntries("$className*-report.json")
        assertEquals(1, files.size, "expected one report for $className, found ${tempDir.listDirectoryEntries().map { it.name }}")
        return files.single().readText()
    }

    private fun scenarioSlice(json: String, title: String): String {
        val key = """"title": "$title""""
        val start = json.indexOf(key)
        assertTrue(start >= 0, "missing scenario '$title'")
        val next = json.indexOf("\"title\": \"", start + key.length)
        return if (next < 0) json.substring(start) else json.substring(start, next)
    }

    companion object {
        const val TESTS_PER_CLASS = 6
        const val MESSAGES_PER_TEST = 40
    }
}

@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class ParallelInjectedFixture {
    @Test fun test1(scenario: LsdScenario) = ParallelFixtureState.captureOffThread(scenario, "i1")

    @Test fun test2(scenario: LsdScenario) = ParallelFixtureState.captureOffThread(scenario, "i2")

    @Test fun test3(scenario: LsdScenario) = ParallelFixtureState.captureOffThread(scenario, "i3")

    @Test fun test4(scenario: LsdScenario) = ParallelFixtureState.captureOffThread(scenario, "i4")

    @Test fun test5(scenario: LsdScenario) = ParallelFixtureState.captureOffThread(scenario, "i5")

    @Test fun test6(scenario: LsdScenario) = ParallelFixtureState.captureOffThread(scenario, "i6")
}

internal object ParallelFixtureState {
    private val inFlight = AtomicInteger()
    val maxInFlight = AtomicInteger()

    fun reset() {
        inFlight.set(0)
        maxInFlight.set(0)
    }

    /** Capture through [scenario] from a new thread that is not bound to any test. */
    fun captureOffThread(scenario: LsdScenario, tag: String) {
        val now = inFlight.incrementAndGet()
        maxInFlight.accumulateAndGet(now) { a, b -> maxOf(a, b) }
        try {
            thread {
                repeat(LsdExtensionParallelTest.MESSAGES_PER_TEST) { i ->
                    scenario.message("Client $tag", "Service", "$tag-$i")
                    Thread.sleep(1)
                }
            }.join()
        } finally {
            inFlight.decrementAndGet()
        }
    }

    /** Fact plus [LsdExtensionParallelTest.MESSAGES_PER_TEST] messages, yielding between them so tests interleave. */
    fun capture(tag: String) {
        val now = inFlight.incrementAndGet()
        maxInFlight.accumulateAndGet(now) { a, b -> maxOf(a, b) }
        try {
            val lsd = LsdContext.instance
            lsd.addFact("test", tag)
            repeat(LsdExtensionParallelTest.MESSAGES_PER_TEST) { i ->
                lsd.message("Client $tag", "Service", "$tag-$i")
                Thread.sleep(1)
            }
        } finally {
            inFlight.decrementAndGet()
        }
    }
}

@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class ParallelFixtureA {
    @Test fun test1() = ParallelFixtureState.capture("a1")

    @Test fun test2() = ParallelFixtureState.capture("a2")

    @Test fun test3() = ParallelFixtureState.capture("a3")

    @Test fun test4() = ParallelFixtureState.capture("a4")

    @Test fun test5() = ParallelFixtureState.capture("a5")

    @Test fun test6() = ParallelFixtureState.capture("a6")
}

@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class ParallelFixtureB {
    @Test fun test1() = ParallelFixtureState.capture("b1")

    @Test fun test2() = ParallelFixtureState.capture("b2")

    @Test fun test3() = ParallelFixtureState.capture("b3")

    @Test fun test4() = ParallelFixtureState.capture("b4")

    @Test fun test5() = ParallelFixtureState.capture("b5")

    @Test fun test6() = ParallelFixtureState.capture("b6")
}
