package io.github.lsdconsulting.lsd.mono.report.html

import java.nio.file.Path

/**
 * The files [ReportWriter.writeReport] wrote for one report. They share a stem: the title plus a
 * short hash of the report key. lsd-mono-jvm's `completeReport` and `report { }` return it too.
 */
public class ReportFiles internal constructor(
    /** `<stem>-diagram.html`: the interactive report page, the one to open. */
    public val diagramHtml: Path,
    /** `<stem>-report.json`: the report's data, which the page also embeds. */
    public val reportJson: Path,
    /** What the index lists for the report. */
    internal val entry: ReportFile,
) {
    override fun equals(other: Any?): Boolean = other is ReportFiles && diagramHtml == other.diagramHtml && reportJson == other.reportJson

    override fun hashCode(): Int = diagramHtml.hashCode()

    override fun toString(): String = "ReportFiles(diagramHtml=$diagramHtml, reportJson=$reportJson)"
}
