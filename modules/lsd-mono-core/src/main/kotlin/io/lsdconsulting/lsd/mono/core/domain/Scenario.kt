package io.lsdconsulting.lsd.mono.core.domain

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties

/**
 * Structured failure for a scenario. Rendered by report as text plus a dialog,
 * not as legacy `:target` overlay HTML inside [Scenario.description].
 */
public data class ScenarioError(
    val headline: String,
    val message: String,
    val stack: String? = null,
) {
    public companion object {
        internal const val HIDDEN_STACK: String = "[Displaying the stacktrace was disabled or no cause was provided]"

        /**
         * The error for a scenario that failed with [cause]: its message and stack trace.
         * The stack trace is replaced by a note when there is no cause or
         * [LsdProperties.HIDE_STACKTRACE] is `true`.
         */
        @JvmStatic
        public fun of(headline: String, cause: Throwable?): ScenarioError =
            ScenarioError(
                headline = headline,
                message = cause?.message.orEmpty(),
                stack = if (cause == null || LsdProperties.hideStacktrace()) HIDDEN_STACK else cause.stackTraceToString(),
            )
    }
}

internal data class Scenario(
    val title: String,
    val description: String = "",
    val status: Status = Status.SUCCESS,
    val facts: List<Fact> = emptyList(),
    val participants: List<Participant> = emptyList(),
    val events: List<SequenceEvent> = emptyList(),
    val error: ScenarioError? = null,
)
