package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.ReportFiles
import io.lsdconsulting.lsd.mono.core.html.Html
import io.lsdconsulting.lsd.mono.core.json.jsonString
import io.lsdconsulting.lsd.mono.core.model.DelayEventJson
import io.lsdconsulting.lsd.mono.core.model.DividerEventJson
import io.lsdconsulting.lsd.mono.core.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.NoteEventJson
import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioJson
import io.lsdconsulting.lsd.mono.core.model.SectionEventJson
import io.lsdconsulting.lsd.mono.core.model.SpacerEventJson
import io.lsdconsulting.lsd.mono.core.model.forShell
import io.lsdconsulting.lsd.mono.core.model.shellPayloadScript
import io.lsdconsulting.lsd.mono.core.model.toJson
import java.io.File
import java.io.StringWriter
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.Properties
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Writes ReportJson, a minimal HTML listing, and the report single-file shell
 * with `window.__LSD_REPORT__` injected so the SVG UI renders the captured scenario.
 * Message bodies are not in that script. They are written beside the diagram as
 * `<stem>-payloads.js` and loaded when the inspector opens.
 * Embedded sample data is only the fallback when that global is absent.
 *
 * **Several writers, one directory.** Test classes, parallel tests, Gradle forks
 * and modules can share an output directory:
 * - Each report's files start with [reportFileStem]: the sanitised title plus a short
 *   hash of the report key (or the title), so two reports never share a file.
 * - Every file is written to a temporary file and moved into place, so a reader
 *   never sees half a file and concurrent writers do not interleave.
 * - Each report also leaves a small entry under `.lsd-index/`. [writeIndex] lists
 *   every entry in the directory, under a file lock, so the index from any writer
 *   includes the reports of all the others.
 * - There are no shared "latest" files (`report.json`, `lsd-report.single.html`).
 */
internal object ReportWriter {
    private const val SHELL_RESOURCE = "/lsd-mono-core/report/lsd-report.single.html"
    private const val INDEX_DIR = ".lsd-index"
    private const val INDEX_LOCK = ".lock"
    private const val MAX_TITLE_CHARS = 80
    private val jvmIndexLock = ReentrantLock()

    /**
     * File-name stem for a report: `<sanitised title>-<8 hex chars>`. The hash is of
     * [reportKey] when given, else of [title], so it is stable across runs and two
     * titles that sanitise to the same text still get different files.
     */
    @JvmStatic
    @JvmOverloads
    fun reportFileStem(title: String, reportKey: String? = null): String =
        "${sanitizeFilename(title)}-${shortHash(reportKey ?: title)}"

    /**
     * Write one report. File names are [reportFileStem]: the title plus a hash of
     * [reportKey] (a test class or feature id) when given, else of the title, so
     * reports with the same title do not collide.
     * @return the diagram, listing and JSON files.
     */
    @JvmStatic
    @JvmOverloads
    fun writeReport(
        report: ReportJson,
        outputDir: File,
        reportKey: String? = null,
    ): ReportFiles {
        outputDir.mkdirs()
        val stem = reportFileStem(report.title, reportKey)
        val jsonName = "$stem-report.json"
        val htmlPath = outputDir.resolve("$stem-report.html").toPath()
        val diagramName = "$stem-diagram.html"
        val payloadsName = "$stem-payloads.js"
        val shellBundle = report.forShell()
        val payloadsPath = outputDir.resolve(payloadsName).toPath()
        if (shellBundle.payloads.isNotEmpty()) {
            writeAtomically(payloadsPath, shellPayloadScript(shellBundle.payloads))
        } else {
            Files.deleteIfExists(payloadsPath)
        }
        val shell = renderShell(shellBundle.report, payloadsName.takeIf { shellBundle.payloads.isNotEmpty() })

        val jsonPath = outputDir.resolve(jsonName).toPath()
        val diagramPath = outputDir.resolve(diagramName).toPath()
        writeAtomically(jsonPath, report.toJson())
        writeAtomically(diagramPath, shell)
        writeAtomically(htmlPath, renderMinimalHtml(report, diagramName, jsonName))
        writeIndexEntry(outputDir, ReportFile(filename = htmlPath.fileName.toString(), title = report.title, status = report.status))
        return ReportFiles(diagramHtml = diagramPath, listingHtml = htmlPath, reportJson = jsonPath)
    }

    /**
     * Write `index.html` listing [reportFiles] plus every report already recorded in
     * [outputDir] by any writer, sorted by title. Safe to call from several threads
     * and processes at once.
     */
    @JvmStatic
    fun writeIndex(
        reportFiles: List<ReportFile>,
        outputDir: File,
    ): Path {
        outputDir.mkdirs()
        val index = outputDir.resolve("index.html").toPath()
        withIndexLock(outputDir) {
            val all =
                (readIndexEntries(outputDir) + reportFiles)
                    .associateBy { it.filename }
                    .values
                    .sortedWith(compareBy<ReportFile> { it.title.lowercase() }.thenBy { it.filename })
            writeAtomically(index, renderIndex(all))
        }
        return index
    }

    private fun renderIndex(reportFiles: List<ReportFile>): String {
        val rowsHtml =
            reportFiles.joinToString("\n") { rf ->
                """
                <tr class="${Html.attribute(rf.status)}">
                  <td><a href="${Html.attribute(rf.filename)}">${Html.text(rf.title)}</a></td>
                  <td>${Html.text(rf.status)}</td>
                </tr>
                """.trimIndent()
            }
        return """
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8"/>
              <title>LSD Mono reports</title>
              <style>
                body { font-family: system-ui, sans-serif; margin: 2rem; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border-bottom: 1px solid #ccc; padding: .5rem; text-align: left; }
                .success { color: #15803d; }
                .warn { color: #a16207; }
                .error { color: #b91c1c; }
              </style>
            </head>
            <body>
              <h1>LSD Mono report index</h1>
              <p>Generated by <code>lsd-mono-core</code>. Each report links to an interactive
                 sequence diagram of its scenarios.</p>
              <table>
                <thead><tr><th>Report</th><th>Status</th></tr></thead>
                <tbody>
                $rowsHtml
                </tbody>
              </table>
            </body>
            </html>
            """.trimIndent()
    }

    private fun writeIndexEntry(outputDir: File, entry: ReportFile) {
        val dir = outputDir.resolve(INDEX_DIR).toPath()
        Files.createDirectories(dir)
        val props =
            Properties().apply {
                setProperty("filename", entry.filename)
                setProperty("title", Html.wellFormed(entry.title))
                setProperty("status", entry.status)
            }
        val text = StringWriter().also { props.store(it, null) }.toString()
        writeAtomically(dir.resolve(entry.filename.removeSuffix(".html") + ".properties"), text)
    }

    private fun readIndexEntries(outputDir: File): List<ReportFile> {
        val dir = outputDir.resolve(INDEX_DIR)
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".properties") } ?: return emptyList()
        return files.mapNotNull { file ->
            val props = Properties()
            runCatching { file.reader(Charsets.UTF_8).use { props.load(it) } }.getOrNull() ?: return@mapNotNull null
            val filename = props.getProperty("filename") ?: return@mapNotNull null
            // An entry whose report was deleted is stale.
            if (!outputDir.resolve(filename).exists()) return@mapNotNull null
            ReportFile(filename, props.getProperty("title").orEmpty(), props.getProperty("status").orEmpty())
        }
    }

    /** One index writer at a time: a lock for this JVM plus a file lock for other processes. */
    private fun withIndexLock(outputDir: File, block: () -> Unit) {
        val dir = outputDir.resolve(INDEX_DIR).toPath()
        Files.createDirectories(dir)
        jvmIndexLock.withLock {
            FileChannel.open(dir.resolve(INDEX_LOCK), StandardOpenOption.CREATE, StandardOpenOption.WRITE).use { channel ->
                channel.lock().use { block() }
            }
        }
    }

    /** Write to a temporary file beside [target], then move it into place. */
    internal fun writeAtomically(target: Path, text: String) {
        val dir = target.toAbsolutePath().parent
        Files.createDirectories(dir)
        val temp = Files.createTempFile(dir, ".${target.fileName}.", ".tmp")
        try {
            // Lone surrogates are escaped or replaced before this; never fail a report on one that is not.
            Files.write(temp, Html.wellFormed(text).toByteArray(Charsets.UTF_8))
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    /**
     * Packaged shell boots with `const re = window.__LSD_REPORT__ ?? sample`.
     * Inject the captured report immediately before that script so file:// viewing works.
     * Values are written with `jsonString`, which escapes `<`, `>`, `&`, U+2028/2029 and
     * lone surrogates, so no report text can close the script element.
     */
    private fun renderShell(report: ReportJson, payloadsFile: String?): String {
        val template = readShellTemplate()
        val src =
            if (payloadsFile == null)
                ""
            else
                "window.__LSD_PAYLOADS_SRC__=${jsonString(payloadsFile)};"
        val injection = "<script>${src}window.__LSD_REPORT__=${report.toJson().trim()};</script>\n"
        val marker = "<script>"
        val idx = template.indexOf(marker)
        return if (idx < 0) injection + template else template.substring(0, idx) + injection + template.substring(idx)
    }

    private fun readShellTemplate(): String {
        val stream =
            ReportWriter::class.java.getResourceAsStream(SHELL_RESOURCE)
                ?: error("Missing classpath resource $SHELL_RESOURCE")
        val raw = stream.bufferedReader().use { it.readText() }
        check("window.__LSD_REPORT__??" in raw) { "$SHELL_RESOURCE does not read window.__LSD_REPORT__" }
        return raw
    }

    internal fun sanitizeFilename(title: String): String =
        title
            .replace(Regex("[^A-Za-z0-9._-]+"), "-")
            .trim('-', '.')
            .take(MAX_TITLE_CHARS)
            .trim('-', '.')
            .ifBlank { "lsd-report" }

    internal fun shortHash(text: String): String =
        MessageDigest
            .getInstance("SHA-256")
            .digest(text.toByteArray(Charsets.UTF_8))
            .take(4)
            .joinToString("") { "%02x".format(it) }

    private fun renderMinimalHtml(report: ReportJson, diagramName: String, jsonName: String): String {
        val scenariosHtml =
            report.scenarios.joinToString("\n") { s ->
                val factsHtml =
                    if (s.facts.isEmpty()) {
                        "<p><em>No facts</em></p>"
                    } else {
                        "<ul>" +
                            s.facts.joinToString("") {
                                "<li><strong>${Html.text(it.key)}</strong>: ${Html.text(it.value)}</li>"
                            } +
                            "</ul>"
                    }
                """
                <section class="scenario ${Html.attribute(s.status)}" id="${Html.attribute(s.id)}">
                  <h2>${Html.text(s.title)}
                    <span class="badge">${Html.text(s.status)}</span>
                  </h2>
                  <div class="description">${Html.text(s.description)}</div>
                  ${errorHtml(s)}
                  <h3>Facts</h3>
                  $factsHtml
                  <h3>Sequence (${s.events.size})</h3>
                  ${eventListHtml(s)}
                </section>
                """.trimIndent()
            }
        return """
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <title>${Html.text(report.title)}</title>
              <style>
                :root { color-scheme: light dark; }
                body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; line-height: 1.45; }
                header { margin-bottom: 1.5rem; border-bottom: 1px solid #8884; padding-bottom: 1rem; }
                .meta { color: #666; font-size: .9rem; }
                .scenario { margin: 1.25rem 0; padding: 1rem; border-radius: 8px; border: 1px solid #8884; }
                .badge { font-size: .75rem; padding: .15rem .45rem; border-radius: 999px; margin-left: .5rem; }
                .success .badge { background: #bbf7d0; color: #14532d; }
                .warn .badge { background: #fde68a; color: #713f12; }
                .error .badge { background: #fecaca; color: #7f1d1d; }
                .note { background: #f1f5f9; padding: .75rem 1rem; border-radius: 6px; margin-top: 1.5rem; }
                @media (prefers-color-scheme: dark) {
                  .note { background: #1e293b; }
                  .success .badge { background: #14532d; color: #bbf7d0; }
                  .warn .badge { background: #713f12; color: #fde68a; }
                  .error .badge { background: #7f1d1d; color: #fecaca; }
                }
              </style>
            </head>
            <body>
              <header>
                <h1>${Html.text(report.title)}</h1>
                <p class="meta">${Html.text(report.generator)} · ${Html.text(report.generatedAt)}</p>
              </header>
              $scenariosHtml
              <div class="note">
                <strong>Interactive diagram:</strong>
                <a href="${Html.attribute(diagramName)}">${Html.text(diagramName)}</a>
                renders this report (injected as <code>window.__LSD_REPORT__</code>).
                JSON: <a href="${Html.attribute(jsonName)}">${Html.text(jsonName)}</a>.
              </div>
            </body>
            </html>
            """.trimIndent()
    }

    private fun errorHtml(scenario: ScenarioJson): String {
        val error = scenario.error ?: return ""
        val stackHtml =
            error.stack?.let { "<pre>${Html.text(it)}</pre>" }.orEmpty()
        return """
            <h3>${Html.text(error.headline)}</h3>
            <p>${Html.text(error.message)}</p>
            $stackHtml
            """.trimIndent()
    }

    private fun eventListHtml(scenario: ScenarioJson): String {
        if (scenario.events.isEmpty()) return "<p><em>No events</em></p>"
        val itemsHtml =
            scenario.events.joinToString("") { event ->
                val label =
                    when (event) {
                        is MessageEventJson -> "${event.from} → ${event.to}: ${event.label} (${event.type})"
                        is NoteEventJson -> {
                            val anchor = event.over?.let { " $it" }.orEmpty()
                            "note ${event.placement}$anchor: ${event.text}"
                        }
                        is DividerEventJson -> "—— ${event.label}"
                        is SectionEventJson -> "section: ${event.title}"
                        is DelayEventJson -> "delay${event.label?.let { ": $it" }.orEmpty()}"
                        is SpacerEventJson -> "spacer${event.heightPx?.let { " ${it}px" }.orEmpty()}"
                        is LifelineEventJson -> "${event.kind} ${event.participantId}"
                    }
                "<li>${Html.text(label)}</li>"
            }
        return "<ol>$itemsHtml</ol>"
    }
}
