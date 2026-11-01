package io.github.lsdconsulting.lsd.mono.jvm.domain

import io.github.lsdconsulting.lsd.mono.jvm.describe
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties

/**
 * Structured failure for a scenario. Rendered by report as text plus a dialog,
 * not as legacy `:target` overlay HTML inside [Scenario.description].
 *
 * Made with [ScenarioError.of].
 *
 * @property headline a short title for the failure, such as `Failed` or `Test aborted`.
 * @property message the failure's message; empty when there is none.
 * @property stack the stack trace, or a note when it is hidden or there is no cause.
 */
public class ScenarioError internal constructor(
    public val headline: String,
    public val message: String,
    public val stack: String? = null,
) {
    override fun equals(other: Any?): Boolean = other is ScenarioError && fields() == other.fields()

    override fun hashCode(): Int = fields().hashCode()

    override fun toString(): String = describe("ScenarioError", fields())

    private fun fields(): Map<String, Any?> = mapOf("headline" to headline, "message" to message, "stack" to stack)

    /** Holds the factories. */
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

        /**
         * The error with [headline], [message] and [stack] as given (null: no stack). [stack] has no
         * default, so `of(headline, null)` still means the [Throwable] form.
         */
        @JvmStatic
        public fun of(
            headline: String,
            message: String,
            stack: String?,
        ): ScenarioError = ScenarioError(headline, message, stack)
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
    val timing: ScenarioTiming = ScenarioTiming(),
)
