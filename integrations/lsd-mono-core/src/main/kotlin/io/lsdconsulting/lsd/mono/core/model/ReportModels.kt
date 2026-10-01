package io.lsdconsulting.lsd.mono.core.model

/**
 * ReportJson-shaped models aligned with report-next `src/types.ts`.
 * Sequence events / participants are optional for the thin façade today.
 */
data class ReportFile(
    val filename: String,
    val title: String,
    val status: String,
)

data class ReportJson(
    val title: String,
    val generatedAt: String,
    val generator: String,
    val scenarios: List<ScenarioJson>,
)

data class ScenarioJson(
    val id: String,
    val title: String,
    val status: String,
    val description: String,
    val facts: List<FactJson>,
    val metrics: List<MetricJson> = emptyList(),
    val participants: List<ParticipantJson> = emptyList(),
    val events: List<Map<String, Any?>> = emptyList(),
)

data class FactJson(
    val key: String,
    val value: String,
)

data class MetricJson(
    val key: String,
    val value: String,
)

data class ParticipantJson(
    val id: String,
    val name: String,
    val type: String = "PARTICIPANT",
    val colour: String? = null,
)
