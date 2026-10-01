package io.lsdconsulting.lsd.mono.core.domain

/**
 * Captured scenario (thin model — full SequenceEvent graph deferred).
 */
data class Scenario(
    val title: String,
    val description: String = "",
    val status: Status = Status.SUCCESS,
    val facts: List<Fact> = emptyList(),
)
