package io.lsdconsulting.lsd.mono.core.domain

/**
 * Scenario outcome, named after the report's Success, Warn and Error filters.
 * The report JSON writes `success`, `warn` and `error`.
 *
 * The integrations use [WARN] for a test that neither passed nor failed with an error,
 * such as a disabled or aborted JUnit test or an undefined Cucumber step.
 */
public enum class Status {
    ERROR,
    WARN,
    SUCCESS,
    ;

    internal fun toReportStatus(): String =
        when (this) {
            SUCCESS -> "success"
            WARN -> "warn"
            ERROR -> "error"
        }

    internal fun toCssClass(): String = toReportStatus()
}
