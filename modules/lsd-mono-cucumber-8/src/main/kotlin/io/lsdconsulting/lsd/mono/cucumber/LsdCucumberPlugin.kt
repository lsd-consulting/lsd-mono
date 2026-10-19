package io.lsdconsulting.lsd.mono.cucumber

import io.cucumber.plugin.ConcurrentEventListener
import io.cucumber.plugin.event.EventPublisher
import io.cucumber.plugin.event.Node
import io.cucumber.plugin.event.PickleStepTestStep
import io.cucumber.plugin.event.Result
import io.cucumber.plugin.event.SnippetsSuggestedEvent
import io.cucumber.plugin.event.TestCase
import io.cucumber.plugin.event.TestCaseFinished
import io.cucumber.plugin.event.TestCaseStarted
import io.cucumber.plugin.event.TestRunFinished
import io.cucumber.plugin.event.TestRunStarted
import io.cucumber.plugin.event.TestSourceParsed
import io.cucumber.plugin.event.TestStep
import io.cucumber.plugin.event.TestStepFinished
import io.cucumber.plugin.event.TestStepStarted
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import java.net.URI
import java.nio.file.Path
import java.nio.file.Paths
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import io.cucumber.plugin.event.Status as CucumberStatus

/**
 * Cucumber 8 plugin. One Cucumber scenario becomes one LSD scenario. The feature
 * feature's `Feature:` name is the report title (its file name when that is blank), and the file
 * name names the report files. Step definitions call [LsdContext] themselves.
 *
 * Uses first-party [LsdContext] from `lsd-mono-core`, not Maven lsd-core.
 * [LsdContext.section] is used when `lsd.mono.cucumber.splitBySteps=true` instead of
 * a PlantUML new page. This plugin does not generate PlantUML.
 *
 * A pending, undefined, ambiguous or skipped scenario is a warning with a [ScenarioError] that
 * says why (the reason and the step), so the report shows it under the description.
 *
 * **Parallel execution.** Safe with `cucumber.execution.parallel.enabled=true` (or
 * `--threads`). Cucumber delivers a scenario's events on the thread that runs it, so
 * each scenario begins its own [io.lsdconsulting.lsd.mono.core.LsdScenario] there,
 * bound to that thread, and completes it from its own `TestCaseFinished`. Each feature
 * file is one report keyed by its URI and titled by its `Feature:` name, written when the run
 * finishes. Scenario outline rows are numbered by their position in the feature file, not by
 * the order they ran.
 */
public class LsdCucumberPlugin : ConcurrentEventListener {
    private val lsd: LsdContext = LsdContext.instance

    /** Feature report key to its title, file name and when it first started, for report order. */
    private val features = ConcurrentHashMap<String, Feature>()
    private val featureOrder = AtomicLong()

    /** Feature report key to the name after `Feature:`, from the parsed source; absent when blank. */
    private val featureNames = ConcurrentHashMap<String, String>()

    /** `uri:line` of each outline example row to its 1-based number within the outline. */
    private val exampleNumbers = ConcurrentHashMap<String, Int>()

    /** Fallback numbering when a row was not in a parsed source (start order). */
    private val outlineCounts = ConcurrentHashMap<String, Int>()

    /**
     * The result of each step (hooks included) of each running test case, by test case id, in the
     * order they finished. A test case's events arrive on one thread, so the inner map is plain.
     */
    private val stepResults = ConcurrentHashMap<UUID, MutableMap<UUID, Result>>()

    /** `uri:line` of each undefined step to the step definitions Cucumber suggests for it. */
    private val snippets = ConcurrentHashMap<String, List<String>>()

    /** Set on Cucumber's thread; read on the threads that run steps. */
    @Volatile
    private var splitByStep: Boolean = false

    override fun setEventPublisher(publisher: EventPublisher) {
        splitByStep = LsdProperties.cucumberSplitBySteps()
        publisher.registerHandlerFor(TestRunStarted::class.java) { reset() }
        publisher.registerHandlerFor(TestSourceParsed::class.java, ::onTestSourceParsed)
        publisher.registerHandlerFor(TestCaseStarted::class.java, ::onTestCaseStarted)
        publisher.registerHandlerFor(TestStepStarted::class.java, ::onTestStepStarted)
        publisher.registerHandlerFor(TestStepFinished::class.java, ::onTestStepFinished)
        publisher.registerHandlerFor(SnippetsSuggestedEvent::class.java, ::onSnippetsSuggested)
        publisher.registerHandlerFor(TestCaseFinished::class.java, ::onTestCaseFinished)
        publisher.registerHandlerFor(TestRunFinished::class.java) { onTestRunFinished() }
    }

    private fun reset() {
        features.clear()
        featureNames.clear()
        exampleNumbers.clear()
        outlineCounts.clear()
        stepResults.clear()
        snippets.clear()
    }

    private fun onTestSourceParsed(event: TestSourceParsed) {
        event.nodes.forEach { node ->
            if (node is Node.Feature) {
                node.name
                    .map(String::trim)
                    .filter(String::isNotEmpty)
                    .ifPresent { featureNames[featureKey(event.uri)] = it }
            }
            numberExamples(event.uri, node)
        }
    }

    private fun numberExamples(uri: URI, node: Node) {
        if (node is Node.ScenarioOutline) {
            var n = 0
            node.elements().forEach { examples ->
                examples.elements().forEach { example -> exampleNumbers["$uri:${example.location.line}"] = ++n }
            }
            return
        }
        if (node is Node.Container<*>) node.elements().forEach { child -> numberExamples(uri, child) }
    }

    private fun onTestCaseStarted(event: TestCaseStarted) {
        // A retried test case starts again under the same id: only its last attempt is reported.
        lsd.findScenario(event.testCase.scenarioKey())?.discard()
        stepResults.remove(event.testCase.id)
        begin(event.testCase, bindCurrentThread = true)
    }

    /** Begin [testCase]'s scenario in its feature's report, noting the feature for the end of the run. */
    private fun begin(testCase: TestCase, bindCurrentThread: Boolean): LsdScenario {
        val key = featureKey(testCase.uri)
        features.computeIfAbsent(key) { Feature(featureTitle(testCase.uri, testCase.name), featureOrder.incrementAndGet()) }
        return lsd.beginScenario(reportKey = key, key = testCase.scenarioKey(), bindCurrentThread = bindCurrentThread)
    }

    /**
     * With splitBySteps, a section per step that runs. Once a step or hook has not passed,
     * Cucumber skips the remaining steps without running them, so they get no (empty) section;
     * the description still lists them, marked skipped.
     */
    private fun onTestStepStarted(event: TestStepStarted) {
        val step = event.testStep
        if (!splitByStep || step !is PickleStepTestStep) return
        val stopped = stepResults[event.testCase.id]?.values?.any { it.status != CucumberStatus.PASSED } == true
        if (!stopped) lsd.findScenario(event.testCase.scenarioKey())?.section(step.line())
    }

    private fun onTestStepFinished(event: TestStepFinished) {
        stepResults.computeIfAbsent(event.testCase.id) { LinkedHashMap() }[event.testStep.id] = event.result
    }

    private fun onSnippetsSuggested(event: SnippetsSuggestedEvent) {
        snippets["${event.uri}:${event.stepLocation.line}"] = event.suggestion.snippets
    }

    private fun onTestCaseFinished(event: TestCaseFinished) {
        val testCase = event.testCase
        val scenario = lsd.findScenario(testCase.scenarioKey()) ?: begin(testCase, bindCurrentThread = false)
        val results = stepResults.remove(testCase.id).orEmpty()
        // Each step on its own line; one that did not pass says how it ended, e.g. "(skipped)".
        val description =
            testCase.testSteps.filterIsInstance<PickleStepTestStep>().joinToString(separator = "\n") { step ->
                val ended = results[step.id]?.status?.takeIf { it != CucumberStatus.PASSED }
                if (ended == null) step.line() else "${step.line()} (${ended.name.lowercase()})"
            }
        val result = event.result
        val status =
            when (result.status) {
                CucumberStatus.PASSED -> Status.SUCCESS
                CucumberStatus.FAILED -> Status.ERROR
                else -> Status.WARN
            }
        // The step (or hook) that gave the test case its result is the one to explain.
        val cause = testCase.testSteps.firstOrNull { results[it.id]?.status == result.status }
        scenario.complete(testCase.scenarioTitle(), description, status, reason(testCase, result, cause))
    }

    /**
     * Why a scenario did not pass, shown under its description: the failure with its stack, or
     * for a pending, undefined, ambiguous or skipped step the reason and the step. Null when it passed.
     */
    private fun reason(testCase: TestCase, result: Result, cause: TestStep?): ScenarioError? {
        val message = result.error?.message?.takeIf { it.isNotBlank() }
        val step = cause?.let { "Step: ${it.line()}" }

        fun lines(vararg parts: String?) = parts.filterNotNull().joinToString("\n").ifEmpty { "No reason given" }
        return when (result.status) {
            CucumberStatus.FAILED -> result.error?.let { ScenarioError.of("Failed", it) }
            CucumberStatus.PENDING -> ScenarioError("Pending", lines(message, step))
            CucumberStatus.SKIPPED -> ScenarioError("Skipped", lines(message, step))
            CucumberStatus.AMBIGUOUS -> ScenarioError("Ambiguous step", lines(message, step))
            CucumberStatus.UNDEFINED -> {
                val suggested = (cause as? PickleStepTestStep)?.let { snippets["${testCase.uri}:${it.step.line}"] }.orEmpty()
                val hint = suggested.takeIf { it.isNotEmpty() }?.joinToString("\n", prefix = "\nImplement it with:\n")
                ScenarioError("Undefined step", lines((cause as? PickleStepTestStep)?.line(), hint))
            }
            else -> null
        }
    }

    private fun onTestRunFinished() {
        val ordered = features.entries.sortedBy { it.value.order }
        // The Feature name is read here, not when the first scenario began, so one parsed late still counts.
        ordered.forEach { (key, feature) ->
            lsd.completeReport(featureNames[key] ?: feature.fileTitle, key, source = "cucumber", fileTitle = feature.fileTitle)
        }
        if (ordered.isNotEmpty()) lsd.createIndex()
        reset()
    }

    private fun TestCase.scenarioKey(): String = "cucumber:$id"

    /** A step as written, `When the card is declined`, or a hook by its code location. */
    private fun TestStep.line(): String =
        if (this is PickleStepTestStep) "${step.keyword.trim()} ${step.text}".trim() else "Hook $codeLocation"

    private fun TestCase.scenarioTitle(): String {
        if (keyword.contains("outline", ignoreCase = true)) {
            val number =
                exampleNumbers["$uri:${location.line}"]
                    ?: outlineCounts.merge("$uri:$name", 1, Int::plus)!!
            return "$name #$number"
        }
        return name
    }
}

/** A feature's report: the [fileTitle] its files are named after (and its title without a Feature name), its start [order]. */
private class Feature(val fileTitle: String, val order: Long)

/**
 * The report key of the feature at [uri], stable across machines: a file under [cwd] becomes its
 * relative path. Any other URI (`classpath:`, a file elsewhere) is kept as it is.
 */
internal fun featureKey(uri: URI, cwd: Path = Paths.get("").toAbsolutePath()): String {
    if (uri.scheme != "file") return uri.toString()
    val path = runCatching { Paths.get(uri) }.getOrNull() ?: return uri.toString()
    return if (path.startsWith(cwd)) cwd.relativize(path).toString().replace('\\', '/') else uri.toString()
}

/**
 * The report title of the feature at [uri] when its `Feature:` name is blank or was not parsed:
 * its file name without `.feature`, else [fallback].
 */
internal fun featureTitle(uri: URI, fallback: String): String {
    val text = uri.toString().substringBefore('?').substringBefore('#')
    val file = text.substringAfterLast('/').substringAfterLast(':')
    return file.removeSuffix(".feature").ifBlank { fallback }
}
