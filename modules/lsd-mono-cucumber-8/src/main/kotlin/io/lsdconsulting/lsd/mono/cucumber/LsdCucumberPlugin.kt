package io.lsdconsulting.lsd.mono.cucumber

import io.cucumber.plugin.ConcurrentEventListener
import io.cucumber.plugin.event.EventPublisher
import io.cucumber.plugin.event.PickleStepTestStep
import io.cucumber.plugin.event.Status as CucumberStatus
import io.cucumber.plugin.event.TestCase
import io.cucumber.plugin.event.TestCaseFinished
import io.cucumber.plugin.event.TestCaseStarted
import io.cucumber.plugin.event.TestRunFinished
import io.cucumber.plugin.event.TestStepStarted
import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.domain.ScenarioError
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import java.util.concurrent.ConcurrentHashMap

/**
 * Cucumber 8 plugin. One Cucumber scenario becomes one LSD scenario. The feature
 * file name is the report title. Step definitions call [LsdContext] themselves.
 *
 * Uses first-party [LsdContext] from `lsd-mono-core`, not Maven lsd-core.
 * [LsdContext.section] is used when `lsd.mono.cucumber.splitBySteps=true` instead of
 * a PlantUML new page. This plugin does not generate PlantUML.
 */
class LsdCucumberPlugin : ConcurrentEventListener {
    private val lsd: LsdContext = LsdContext.instance
    private val finished: MutableList<TestCaseFinished> = ArrayList()
    private val outlineCounts: ConcurrentHashMap<String, Int> = ConcurrentHashMap()

    private var scenarioName: String? = null
    private var featureName: String? = null
    private var splitByStep: Boolean = false

    override fun setEventPublisher(publisher: EventPublisher) {
        splitByStep = LsdProperties.getBoolean(SPLIT_BY_STEPS, false)
        publisher.registerHandlerFor(TestCaseStarted::class.java, ::onTestCaseStarted)
        publisher.registerHandlerFor(TestStepStarted::class.java, ::onTestStepStarted)
        publisher.registerHandlerFor(TestCaseFinished::class.java, finished::add)
        publisher.registerHandlerFor(TestRunFinished::class.java) { onTestRunFinished() }
    }

    private fun onTestStepStarted(event: TestStepStarted) {
        val step = event.testStep
        if (splitByStep && step is PickleStepTestStep) {
            lsd.section("${step.step.keyword}${step.step.text}".trim())
        }
    }

    private fun onTestCaseStarted(event: TestCaseStarted) {
        val currentFeature = event.testCase.featureTitle()
        val currentScenario = event.testCase.scenarioTitle()
        if (scenarioName == null) {
            scenarioName = currentScenario
            featureName = currentFeature
            return
        }
        finishScenario()
        if (!currentFeature.equals(featureName, ignoreCase = true)) {
            finishFeature()
        }
        finished.clear()
        scenarioName = currentScenario
        featureName = currentFeature
    }

    private fun onTestRunFinished() {
        val feature = featureName?.takeIf { it.isNotBlank() } ?: return
        finishScenario()
        lsd.completeReport(feature)
        lsd.createIndex()
    }

    private fun finishFeature() {
        val feature = featureName?.takeIf { it.isNotBlank() } ?: return
        lsd.completeReport(feature)
    }

    private fun finishScenario() {
        val title = scenarioName ?: return
        val steps = finished
            .flatMap { it.testCase.testSteps }
            .filterIsInstance<PickleStepTestStep>()
        val description = steps.joinToString(separator = "\n") { step ->
            "${step.step.keyword.trim()} ${step.step.text}".trim()
        }
        val failed = finished.filter { it.result.status == CucumberStatus.FAILED }
        val status = when {
            failed.isNotEmpty() -> Status.ERROR
            finished.any { it.result.status != CucumberStatus.PASSED } -> Status.FAILURE
            else -> Status.SUCCESS
        }
        val cause = failed.firstNotNullOfOrNull { it.result.error }
        val error = cause?.let {
            ScenarioError(
                headline = "Failed",
                message = it.message.orEmpty(),
                stack = if (LsdProperties.hideStacktrace()) {
                    "[Displaying the stacktrace was disabled or no cause was provided]"
                } else {
                    it.stackTraceToString()
                },
            )
        }
        lsd.completeScenario(title, description, status, error)
        scenarioName = null
    }

    private fun TestCase.scenarioTitle(): String {
        if (keyword.contains("outline", ignoreCase = true)) {
            val next = outlineCounts.merge(name, 1, Int::plus)!!
            return "$name #$next"
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
