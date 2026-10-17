package io.lsdconsulting.lsd.mono.cucumber

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
internal fun reportJson(dir: Path, feature: String): String {
    val files = dir.listDirectoryEntries("$feature-*-report.json")
    check(files.size == 1) { "expected one report for $feature in ${dir.listDirectoryEntries().map { it.name }}" }
    return files.single().readText()
}

/**
 * The scenarios in a report's JSON by title, each as its own JSON text. Relies on the writer's
 * two-space indentation: a scenario object opens at four spaces with its `id` first.
 */
internal fun scenariosByTitle(json: String): Map<String, String> =
    json
        .split(Regex("""\n {4}\{\n {6}"id": """))
        .drop(1)
        .associateBy { Regex("""\n {6}"title": "([^"]*)"""").find(it)!!.groupValues[1] }
