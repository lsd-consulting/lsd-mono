package io.lsdconsulting.lsd.mono.core

import java.nio.file.Path

/**
 * The files one report was written to, returned by [LsdContext.completeReport] and
 * [LsdContext.report]. Both share a stem: the title plus a short hash of the report key.
 */
public class ReportFiles internal constructor(
    /** `<stem>-diagram.html`: the interactive sequence diagram. The page to open for this report; `index.html` shows every report in the directory. */
    public val diagramHtml: Path,
    /** `<stem>-report.json`: the report's data, which the diagram page also embeds. */
    public val reportJson: Path,
) {
    override fun equals(other: Any?): Boolean =
        other is ReportFiles && diagramHtml == other.diagramHtml && reportJson == other.reportJson

    override fun hashCode(): Int = diagramHtml.hashCode()

    override fun toString(): String = "ReportFiles(diagramHtml=$diagramHtml, reportJson=$reportJson)"
}
