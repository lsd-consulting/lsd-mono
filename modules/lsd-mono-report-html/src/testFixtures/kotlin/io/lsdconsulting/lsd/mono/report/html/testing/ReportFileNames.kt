package io.lsdconsulting.lsd.mono.report.html.testing

import io.lsdconsulting.lsd.mono.report.html.ReportWriter

/**
 * The names of the files [ReportWriter] writes, for tests that read them back. The writer keeps
 * its naming internal; this is the one way to it outside lsd-mono-report-html, and is not
 * published.
 */
public object ReportFileNames {
    /** The stem every file of the report titled [title] starts with: `<sanitised title>-<8 hex chars>`. */
    public fun stem(
        title: String,
        reportKey: String? = null,
    ): String = ReportWriter.reportFileStem(title, reportKey)
}
