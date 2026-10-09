package io.lsdconsulting.lsd.mono.cucumber.readme

import io.cucumber.core.cli.Main
import io.lsdconsulting.lsd.mono.core.LsdContext

/**
 * Scenario shown in the Cucumber module README.
 * `:modules:lsd-mono-cucumber-8:readmeSamples` screenshots the report this writes.
 *
 * Runs the feature through [io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin].
 * Keep the captures in sync with that README (the label must stay `POST /orders`).
 */
fun main(args: Array<String>) {
    val feature = args.singleOrNull() ?: error("usage: CucumberReadmeSample <feature file>")
    System.setProperty("cucumber.publish.enabled", "false")
    LsdContext.instance.clear()
    val status = Main.run(
        arrayOf(
            "--plugin",
            "io.lsdconsulting.lsd.mono.cucumber.LsdCucumberPlugin",
            "--glue",
            "io.lsdconsulting.lsd.mono.cucumber.readme",
            "--monochrome",
            feature,
        ),
        Thread.currentThread().contextClassLoader,
    )
    check(status.toInt() == 0) { "Cucumber readme sample failed with status $status" }
}
