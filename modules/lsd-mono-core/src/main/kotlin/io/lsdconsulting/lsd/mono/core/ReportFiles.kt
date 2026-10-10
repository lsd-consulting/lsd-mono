package io.lsdconsulting.lsd.mono.core

import java.nio.file.Path

/**
 * The files one report was written to, returned by [LsdContext.completeReport] and
 * [LsdContext.report]. All three share a stem: the title plus a short hash of the report key.
 */
public class ReportFiles internal constructor(
    /** `<stem>-diagram.html`: the interactive sequence diagram. This is the page to open. */
    public val diagramHtml: Path,
    /** `<stem>-report.html`: a short page that lists the scenarios and links to the diagram and the JSON. `index.html` links here. */
    public val listingHtml: Path,
    /** `<stem>-report.json`: the report's data, which the diagram page also embeds. */
    public val reportJson: Path,
) {
    override fun equals(other: Any?): Boolean =
        other is ReportFiles && diagramHtml == other.diagramHtml && listingHtml == other.listingHtml && reportJson == other.reportJson

    override fun hashCode(): Int = diagramHtml.hashCode()

    override fun toString(): String = "ReportFiles(diagramHtml=$diagramHtml, listingHtml=$listingHtml, reportJson=$reportJson)"
}
