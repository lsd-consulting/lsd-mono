package io.lsdconsulting.lsd.mono.cucumber

import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import org.junit.platform.engine.discovery.DiscoverySelectors.selectClasspathResource
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder
import org.junit.platform.launcher.core.LauncherFactory
import org.junit.platform.launcher.listeners.SummaryGeneratingListener
import org.junit.platform.launcher.listeners.TestExecutionSummary
import java.nio.file.Path
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

private const val FIXTURE = "io/lsdconsulting/lsd/mono/cucumber/fixture"

/**
 * Runs [features] (paths under the fixture resources, such as `place_order.feature`) through
 * Cucumber's JUnit Platform engine with [LsdCucumberPlugin] and the fixture glue.
 */
internal fun runFeatures(
    vararg features: String,
    parameters: Map<String, String> = emptyMap(),
): TestExecutionSummary {
    val listener = SummaryGeneratingListener()
    val request =
        LauncherDiscoveryRequestBuilder
            .request()
            .selectors(features.map { selectClasspathResource("$FIXTURE/$it") })
            .configurationParameter("cucumber.glue", FIXTURE.replace('/', '.'))
            .configurationParameter("cucumber.plugin", LsdCucumberPlugin::class.java.name)
            .configurationParameter("cucumber.publish.enabled", "false")
            .configurationParameters(parameters)
            .build()
    LauncherFactory.create().execute(request, listener)
    return listener.summary
}

/** The one `<feature>-*-report.json` in [dir]. */
internal fun reportJson(dir: Path, feature: String): String = ReportJson.single(dir, "$feature-*-report.json").text

/** The scenarios in a report's JSON by title, each as the text it was written as. Titles must be unique. */
internal fun scenariosByTitle(json: String): Map<String, String> {
    val scenarios = ReportJson(json).scenarios
    check(scenarios.map { it.title }.toSet().size == scenarios.size) { "duplicate titles: ${scenarios.map { it.title }}" }
    return scenarios.associate { it.title to it.json }
}
