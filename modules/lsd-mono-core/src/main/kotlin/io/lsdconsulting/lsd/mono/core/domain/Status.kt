package io.lsdconsulting.lsd.mono.core.domain

/**
 * Scenario outcome. CSS/report mapping:
 * SUCCESS → success, FAILURE → warn, ERROR → error.
 */
public enum class Status {
    ERROR,
    FAILURE,
    SUCCESS,
    ;

    internal fun toReportStatus(): String =
        when (this) {
            SUCCESS -> "success"
            FAILURE -> "warn"
            ERROR -> "error"
        }

    internal fun toCssClass(): String = toReportStatus()
}
