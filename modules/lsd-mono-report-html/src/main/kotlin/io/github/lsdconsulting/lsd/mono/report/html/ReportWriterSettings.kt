package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.ExperimentalLsdReportModel
import java.time.Instant

/**
 * What [ReportWriter] writes beyond the reports it is given. The index page's manifest says what
 * wrote it ([generator], such as `my-adapter 1.0`), when ([generatedAt], or the time of writing
 * when null) and whether the page may send the usage ping ([usagePing]). The writer reads no
 * properties or environment of its own.
 */
@ExperimentalLsdReportModel
public class ReportWriterSettings
    @JvmOverloads
    constructor(
        public val generator: String,
        public val generatedAt: Instant? = null,
        public val usagePing: Boolean = true,
    ) {
        override fun equals(other: Any?): Boolean =
            other is ReportWriterSettings &&
                generator == other.generator &&
                generatedAt == other.generatedAt &&
                usagePing == other.usagePing

        override fun hashCode(): Int = generator.hashCode()

        override fun toString(): String = "ReportWriterSettings(generator=$generator, generatedAt=$generatedAt, usagePing=$usagePing)"
    }
