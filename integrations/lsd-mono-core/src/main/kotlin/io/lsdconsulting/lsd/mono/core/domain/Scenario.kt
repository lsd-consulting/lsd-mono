package io.lsdconsulting.lsd.mono.core.domain

data class Scenario(
    val title: String,
    val description: String = "",
    val status: Status = Status.SUCCESS,
    val facts: List<Fact> = emptyList(),
    val participants: List<Participant> = emptyList(),
    val events: List<SequenceEvent> = emptyList(),
)
