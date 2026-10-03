package io.lsdconsulting.lsd.mono.core.domain

/**
 * Structured failure for a scenario. Rendered by report-next as text plus a dialog,
 * not as legacy `:target` overlay HTML inside [Scenario.description].
 */
data class ScenarioError(
    val headline: String,
    val message: String,
    val stack: String? = null,
)

data class Scenario(
    val title: String,
    val description: String = "",
    val status: Status = Status.SUCCESS,
    val facts: List<Fact> = emptyList(),
    val participants: List<Participant> = emptyList(),
    val events: List<SequenceEvent> = emptyList(),
    val error: ScenarioError? = null,
)
