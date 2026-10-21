package io.lsdconsulting.lsd.mono.core.report

import java.time.Instant

/**
 * What [ReportWriter] writes beyond the reports it is given: the index page's manifest says who
 * wrote it ([generator]), when ([generatedAt], or the time of writing when null), and whether the
 * page may send the usage ping ([usagePing]). The caller decides them; the writer reads no
 * properties.
 */
internal data class ReportWriterSettings(
    val generator: String,
    val generatedAt: Instant? = null,
    val usagePing: Boolean = true,
)
