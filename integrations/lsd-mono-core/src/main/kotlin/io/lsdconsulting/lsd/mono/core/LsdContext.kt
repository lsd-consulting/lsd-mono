package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Fact
import io.lsdconsulting.lsd.mono.core.domain.Scenario
import io.lsdconsulting.lsd.mono.core.domain.Status
import io.lsdconsulting.lsd.mono.core.model.FactJson
import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import io.lsdconsulting.lsd.mono.core.report.ReportWriter
import java.io.File
import java.nio.file.Path
import java.time.OffsetDateTime
import java.time.ZoneId

/**
 * Thin mono capture/report façade inspired by legacy `com.lsd.core.LsdContext`
 * entry points so JUnit and other integrations can migrate without Maven lsd-core.
 *
 * **Ported now:** facts, scenario completion, report/index/components stub writers,
 * id generation, clear. **Deferred:** SequenceEvent capture graph, PlantUML diagrams,
 * full ReportJson event/participant emission (empty arrays today).
 */
open class LsdContext {

    val idGenerator = IdGenerator(LsdProperties.deterministicIds())
    val outputDirectory: File = File(LsdProperties.outputDirectory())

    private val scenarios: MutableList<Scenario> = ArrayList()
    private val reportFiles: MutableList<ReportFile> = ArrayList()
    private val currentFacts: MutableList<Fact> = ArrayList()

    fun addFact(key: String, value: String = "") {
        currentFacts.add(Fact(key, value))
    }

    /**
     * Sequence-event capture is deferred. Calls are accepted as a no-op so
     * migration code that still captures events can compile against this façade
     * once event types land; today they do not affect the diagram.
     */
    open fun capture(vararg ignored: Any?) {
        // Deferred: SequenceEvent model + report-next JSON injection.
    }

    @JvmOverloads
    fun completeScenario(
        title: String,
        description: String? = "",
        status: Status = Status.SUCCESS,
    ) {
        scenarios.add(
            Scenario(
                title = title,
                description = description.orEmpty(),
                status = status,
                facts = currentFacts.toList(),
            ),
        )
        currentFacts.clear()
    }

    @JvmOverloads
    fun completeReport(title: String): Path {
        val report = buildReportJson(title)
        val overall = determineOverallStatus(scenarios)
        val path =
            ReportWriter.writeReport(
                report = report,
                outputDir = outputDirectory,
                statusCss = overall,
            )
        reportFiles.add(
            ReportFile(
                filename = path.fileName.toString(),
                title = report.title,
                status = overall,
            ),
        )
        scenarios.clear()
        currentFacts.clear()
        return path
    }

    @JvmOverloads
    fun completeComponentsReport(title: String): Path =
        ReportWriter.writeComponentsStub(title, outputDirectory)

    fun createIndex(): Path = ReportWriter.writeIndex(reportFiles.toList(), outputDirectory)

    fun clear() {
        idGenerator.reset()
        scenarios.clear()
        reportFiles.clear()
        currentFacts.clear()
    }

    fun clearScenarioEvents() {
        // No event buffer yet; facts for the in-flight scenario are kept.
    }

    private fun buildReportJson(title: String): ReportJson =
        ReportJson(
            title = title,
            generatedAt = OffsetDateTime.now(ZoneId.of("Europe/London")).toString(),
            generator = "lsd-mono-core 0.0.1-SNAPSHOT",
            scenarios =
                scenarios.map { scenario ->
                    ScenarioJson(
                        id = idGenerator.next(),
                        title = scenario.title,
                        status = scenario.status.toReportStatus(),
                        description = scenario.description,
                        facts = scenario.facts.map { FactJson(it.key, it.value) },
                    )
                },
        )

    private fun determineOverallStatus(scenarios: List<Scenario>): String =
        scenarios
            .map { it.status }
            .sortedWith(
                compareBy {
                    when (it) {
                        Status.ERROR -> 0
                        Status.FAILURE -> 1
                        Status.SUCCESS -> 2
                    }
                },
            ).firstOrNull()
            ?.toCssClass()
            ?: "success"

    companion object {
        @JvmStatic
        val instance = LsdContext()
    }
}
