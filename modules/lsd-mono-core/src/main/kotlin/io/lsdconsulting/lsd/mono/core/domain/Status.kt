package io.lsdconsulting.lsd.mono.core.domain

/**
 * Scenario outcome. CSS/report-next mapping:
 * SUCCESS → success, FAILURE → warn, ERROR → error.
 */
enum class Status {
    ERROR,
    FAILURE,
    SUCCESS,
    ;

    fun toReportStatus(): String =
        when (this) {
            SUCCESS -> "success"
            FAILURE -> "warn"
            ERROR -> "error"
        }

    fun toCssClass(): String = toReportStatus()
}
