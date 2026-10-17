package io.lsdconsulting.lsd.mono.cucumber

import io.cucumber.plugin.event.EventHandler
import io.cucumber.plugin.event.EventPublisher
import io.cucumber.plugin.event.Location
import io.cucumber.plugin.event.Result
import io.cucumber.plugin.event.Status
import io.cucumber.plugin.event.TestCase
import io.cucumber.plugin.event.TestCaseFinished
import io.cucumber.plugin.event.TestCaseStarted
import io.cucumber.plugin.event.TestRunFinished
import io.cucumber.plugin.event.TestRunStarted
import io.cucumber.plugin.event.TestStep
import io.lsdconsulting.lsd.mono.core.LsdContext
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.net.URI
import java.nio.file.Path
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.io.path.exists

/**
 * Drives [LsdCucumberPlugin] with hand-made events, for orders Cucumber's engine does not
 * produce in a normal run: a retried test case, a finish with no start, outline rows with no
 * parsed source, and a run with no scenarios.
 */
class LsdCucumberPluginEventsTest {
    @TempDir
    lateinit var tempDir: Path

    private val lsd = LsdContext.instance
    private val publisher = FakePublisher()

    @BeforeEach
    fun setUp() {
        System.setProperty("lsd.mono.report.outputDir", tempDir.toString())
        lsd.clear()
        LsdCucumberPlugin().setEventPublisher(publisher)
        publisher.publish(TestRunStarted(Instant.now()))
    }

    @AfterEach
    fun restore() {
        System.setProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
        lsd.clear()
    }

    @Test
    fun `a retried test case keeps only its last attempt`() {
        val testCase = FakeTestCase("checkout")
        publisher.publish(TestCaseStarted(Instant.now(), testCase))
        lsd.message("Customer", "Shop", "first attempt")
        publisher.publish(TestCaseStarted(Instant.now(), testCase))
        lsd.message("Customer", "Shop", "second attempt")
        publisher.finish(testCase, Status.PASSED)
        publisher.publish(runFinished())

        val json = reportJson(tempDir, "shop")
        assertEquals(listOf("second attempt"), labels(json))
    }

    @Test
    fun `a finish with no start still reports the scenario`() {
        val testCase = FakeTestCase("checkout")
        publisher.finish(testCase, Status.FAILED, IllegalStateException("boom"))
        publisher.publish(runFinished())

        val scenario = scenariosByTitle(reportJson(tempDir, "shop")).getValue("checkout")
        assertEquals(""""status": "error"""", Regex(""""status": "\w+"""").find(scenario)!!.value)
    }

    @Test
    fun `outline rows with no parsed source are numbered in the order they start`() {
        val rows = listOf(FakeTestCase("pays", keyword = "Scenario Outline", line = 9), FakeTestCase("pays", keyword = "Scenario Outline", line = 10))
        rows.forEach { row ->
            publisher.publish(TestCaseStarted(Instant.now(), row))
            publisher.finish(row, Status.PASSED)
        }
        publisher.publish(runFinished())

        assertEquals(setOf("pays #1", "pays #2"), scenariosByTitle(reportJson(tempDir, "shop")).keys)
    }

    @Test
    fun `a run with no scenarios writes no report and no index`() {
        publisher.publish(runFinished())

        assertFalse(tempDir.resolve("index.html").exists())
    }

    private fun labels(json: String) = Regex(""""label": "([^"]+)"""").findAll(json).map { it.groupValues[1] }.toList()

    private class FakePublisher : EventPublisher {
        private val handlers = mutableMapOf<Class<*>, MutableList<EventHandler<*>>>()

        override fun <T : Any> registerHandlerFor(eventType: Class<T>, handler: EventHandler<T>) {
            handlers.getOrPut(eventType) { mutableListOf() } += handler
        }

        override fun <T : Any> removeHandlerFor(eventType: Class<T>, handler: EventHandler<T>) {
            handlers[eventType]?.remove(handler)
        }

        @Suppress("UNCHECKED_CAST")
        fun publish(event: Any) {
            handlers[event.javaClass].orEmpty().forEach { (it as EventHandler<Any>).receive(event) }
        }

        fun finish(testCase: TestCase, status: Status, error: Throwable? = null) {
            publish(TestCaseFinished(Instant.now(), testCase, Result(status, Duration.ZERO, error)))
        }
    }

    private class FakeTestCase(
        private val name: String,
        private val keyword: String = "Scenario",
        private val line: Int = 3,
    ) : TestCase {
        private val id = UUID.randomUUID()

        @Deprecated("Cucumber deprecates it")
        override fun getLine(): Int = line

        override fun getLocation() = Location(line, 3)

        override fun getKeyword() = keyword

        override fun getName() = name

        @Deprecated("Cucumber deprecates it")
        override fun getScenarioDesignation() = "shop.feature:$line # $name"

        override fun getLanguage() = "en"

        override fun getTags() = emptyList<String>()

        override fun getTestSteps() = emptyList<TestStep>()

        override fun getUri() = URI("classpath:shop.feature")

        override fun getId(): UUID = id
    }

    /** The run's end, passed. The one-argument constructor is deprecated. */
    private fun runFinished() = TestRunFinished(Instant.now(), Result(Status.PASSED, Duration.ZERO, null))
}
