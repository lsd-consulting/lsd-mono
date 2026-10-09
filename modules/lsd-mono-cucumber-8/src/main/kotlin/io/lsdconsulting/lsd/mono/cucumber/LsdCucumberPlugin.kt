package io.lsdconsulting.lsd.mono.cucumber

import io.cucumber.plugin.ConcurrentEventListener
import io.cucumber.plugin.event.EventPublisher
import io.cucumber.plugin.event.Node
import io.cucumber.plugin.event.PickleStepTestStep
import io.cucumber.plugin.event.TestCase
import io.cucumber.plugin.event.TestCaseFinished
import io.cucumber.plugin.event.TestCaseStarted
import io.cucumber.plugin.event.TestRunFinished
import io.cucumber.plugin.event.TestRunStarted
import io.cucumber.plugin.event.TestSourceParsed
import io.cucumber.plugin.event.TestStepStarted
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Section
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import java.net.URI
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import io.cucumber.plugin.event.Status as CucumberStatus

/**
 * Cucumber 8 plugin. One Cucumber scenario becomes one LSD scenario. The feature
 * file name is the report title. Step definitions call [LsdContext] themselves.
 *
 * Uses first-party [LsdContext] from `lsd-mono-core`, not Maven lsd-core.
 * [LsdContext.section] is used when `lsd.mono.cucumber.splitBySteps=true` instead of
 * a PlantUML new page. This plugin does not generate PlantUML.
 *
 * **Parallel execution.** Safe with `cucumber.execution.parallel.enabled=true` (or
 * `--threads`). Cucumber delivers a scenario's events on the thread that runs it, so
 * each scenario begins its own [io.lsdconsulting.lsd.mono.core.LsdScenario] there,
 * bound to that thread, and completes it from its own `TestCaseFinished`. Each feature
 * file is one report keyed by its URI, written when the run finishes. Scenario outline
 * rows are numbered by their position in the feature file, not by the order they ran.
 */
class LsdCucumberPlugin : ConcurrentEventListener {
    private val lsd: LsdContext = LsdContext.instance

    /** Feature URI to its title and when it first started, for report order. */
    private val features = ConcurrentHashMap<String, Pair<String, Long>>()
    private val featureOrder = AtomicLong()

    /** `uri:line` of each outline example row to its 1-based number within the outline. */
    private val exampleNumbers = ConcurrentHashMap<String, Int>()

    /** Fallback numbering when a row was not in a parsed source (start order). */
    private val outlineCounts = ConcurrentHashMap<String, Int>()

    private var splitByStep: Boolean = false

    override fun setEventPublisher(publisher: EventPublisher) {
        splitByStep = LsdProperties.getBoolean(SPLIT_BY_STEPS, false)
        publisher.registerHandlerFor(TestRunStarted::class.java) { reset() }
        publisher.registerHandlerFor(TestSourceParsed::class.java, ::onTestSourceParsed)
        publisher.registerHandlerFor(TestCaseStarted::class.java, ::onTestCaseStarted)
        publisher.registerHandlerFor(TestStepStarted::class.java, ::onTestStepStarted)
        publisher.registerHandlerFor(TestCaseFinished::class.java, ::onTestCaseFinished)
        publisher.registerHandlerFor(TestRunFinished::class.java) { onTestRunFinished() }
    }

    private fun reset() {
        features.clear()
        exampleNumbers.clear()
        outlineCounts.clear()
    }

    private fun onTestSourceParsed(event: TestSourceParsed) {
        event.nodes.forEach { node -> numberExamples(event.uri, node) }
    }

    private fun numberExamples(uri: URI, node: Node) {
        if (node is Node.ScenarioOutline) {
            var n = 0
            node.elements().forEach { examples ->
                examples.elements().forEach { example -> exampleNumbers["$uri:${example.location.line}"] = ++n }
            }
            return
        }
        if (node is Node.Container<*>) node.elements().forEach { child -> numberExamples(uri, child as Node) }
    }

    private fun onTestCaseStarted(event: TestCaseStarted) {
        val testCase = event.testCase
        val featureKey = testCase.featureKey()
        features.computeIfAbsent(featureKey) { testCase.featureTitle() to featureOrder.incrementAndGet() }
        lsd.findScenario(testCase.scenarioKey())?.discard()
        lsd.beginScenario(reportKey = featureKey, key = testCase.scenarioKey())
    }

    private fun onTestStepStarted(event: TestStepStarted) {
        val step = event.testStep
        if (splitByStep && step is PickleStepTestStep) {
            lsd
                .findScenario(event.testCase.scenarioKey())
                ?.capture(Section(id = "", title = "${step.step.keyword}${step.step.text}".trim()))
        }
    }

    private fun onTestCaseFinished(event: TestCaseFinished) {
        val testCase = event.testCase
        val scenario =
            lsd.findScenario(testCase.scenarioKey())
                ?: lsd.beginScenario(reportKey = testCase.featureKey(), key = testCase.scenarioKey(), bindCurrentThread = false)
        val description =
            testCase.testSteps
                .filterIsInstance<PickleStepTestStep>()
                .joinToString(separator = "\n") { step -> "${step.step.keyword.trim()} ${step.step.text}".trim() }
        val result = event.result
        val status =
            when (result.status) {
                CucumberStatus.PASSED -> Status.SUCCESS
                CucumberStatus.FAILED -> Status.ERROR
                else -> Status.FAILURE
            }
        val error =
            result.error?.takeIf { result.status == CucumberStatus.FAILED }?.let {
                ScenarioError(
                    headline = "Failed",
                    message = it.message.orEmpty(),
                    stack =
                        if (LsdProperties.hideStacktrace()) {
                            "[Displaying the stacktrace was disabled or no cause was provided]"
                        } else {
                            it.stackTraceToString()
                        },
                )
            }
        scenario.complete(testCase.scenarioTitle(), description, status, error)
    }

    private fun onTestRunFinished() {
        val ordered = features.entries.sortedBy { it.value.second }
        ordered.forEach { (key, value) -> lsd.completeReport(value.first, key) }
        if (ordered.isNotEmpty()) lsd.createIndex()
        reset()
    }

    private fun TestCase.scenarioKey(): String = "cucumber:$id"

    /** Stable across machines: a file URI under the working directory becomes a relative path. */
    private fun TestCase.featureKey(): String {
        val uri = uri
        if (uri.scheme != "file") return uri.toString()
        val path = runCatching { Paths.get(uri) }.getOrNull() ?: return uri.toString()
        val cwd: Path = Paths.get("").toAbsolutePath()
        return if (path.startsWith(cwd)) cwd.relativize(path).toString().replace('\\', '/') else uri.toString()
    }

    private fun TestCase.scenarioTitle(): String {
        if (keyword.contains("outline", ignoreCase = true)) {
            val number =
                exampleNumbers["$uri:${location.line}"]
                    ?: outlineCounts.merge("$uri:$name", 1, Int::plus)!!
            return "$name #$number"
        }
        return name
    }

    private fun TestCase.featureTitle(): String {
        val text = uri.toString().substringBefore('?').substringBefore('#')
        val file = text.substringAfterLast('/').substringAfterLast(':')
        return file.removeSuffix(".feature").ifBlank { name }
    }

    companion object {
        const val SPLIT_BY_STEPS = "lsd.mono.cucumber.splitBySteps"
    }
}
