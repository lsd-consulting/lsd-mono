package io.lsdconsulting.lsd.mono.core.report

import io.lsdconsulting.lsd.mono.core.ReportFiles
import io.lsdconsulting.lsd.mono.core.html.Html
import io.lsdconsulting.lsd.mono.core.json.jsonString
import io.lsdconsulting.lsd.mono.core.model.DelayEventJson
import io.lsdconsulting.lsd.mono.core.model.DividerEventJson
import io.lsdconsulting.lsd.mono.core.model.IndexScenario
import io.lsdconsulting.lsd.mono.core.model.LifelineEventJson
import io.lsdconsulting.lsd.mono.core.model.MessageEventJson
import io.lsdconsulting.lsd.mono.core.model.NoteEventJson
import io.lsdconsulting.lsd.mono.core.model.ReportFile
import io.lsdconsulting.lsd.mono.core.model.ReportJson
import io.lsdconsulting.lsd.mono.core.model.ScenarioCounts
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
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.security.MessageDigest
import java.util.Properties
import java.util.UUID
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
    private const val INDEX_FORMAT = "2"
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
        val payloadsSrc = payloadsName.takeIf { shellBundle.payloads.isNotEmpty() }
        val shell = renderShell(shellBundle.report, payloadsSrc)
        val dataName = "$stem-report.js"
        writeAtomically(outputDir.resolve(dataName).toPath(), reportDataScript(stem, shellBundle.report, payloadsSrc))

        val jsonPath = outputDir.resolve(jsonName).toPath()
        val diagramPath = outputDir.resolve(diagramName).toPath()
        writeAtomically(jsonPath, report.toJson())
        writeAtomically(diagramPath, shell)
        writeAtomically(htmlPath, renderMinimalHtml(report, diagramName, jsonName))
        writeIndexEntry(
            outputDir,
            ReportFile(
                filename = diagramName,
                title = report.title,
                status = report.status,
                counts = ScenarioCounts.of(report.scenarios.map { it.status }),
                stem = stem,
                dataScript = dataName,
                scenarios = report.scenarios.map { IndexScenario(it.id, it.title, it.status, it.events.count { e -> e is MessageEventJson }) },
            ),
        )
        return ReportFiles(diagramHtml = diagramPath, listingHtml = htmlPath, reportJson = jsonPath)
    }

    /**
     * Write `index.html` listing [reportFiles] plus every report already recorded in
     * [outputDir] by any writer: failed reports first, then by title. Safe to call from several threads
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
                    .sortedWith(indexOrder)
            writeAtomically(index, renderIndex(all))
        }
        return index
    }

    /** Failures first, then warnings, then the rest; by title within each. */
    private val indexOrder: Comparator<ReportFile> =
        compareBy<ReportFile> { STATUS_ORDER.indexOf(it.status).let { rank -> if (rank < 0) STATUS_ORDER.size else rank } }
            .thenBy { it.title.lowercase() }
            .thenBy { it.filename }

    private val STATUS_ORDER = listOf("error", "warn", "success")

    private fun statusText(status: String): String =
        when (status) {
            "error" -> "Failed"
            "warn" -> "Warning"
            "success" -> "Passed"
            else -> status
        }

    private fun statusIcon(status: String): String =
        when (status) {
            "error" -> "✕"
            "warn" -> "!"
            "success" -> "✓"
            else -> "·"
        }

    internal fun renderIndex(reportFiles: List<ReportFile>): String {
        val totals = reportFiles.fold(ScenarioCounts()) { acc, rf -> acc + rf.counts }
        val failedReports = reportFiles.count { it.status == "error" }
        val failedOnlyStateHtml = if (failedReports == 0) " disabled" else ""
        val rowsHtml =
            reportFiles.joinToString("\n") { rf ->
                val c = rf.counts
                val stem = rf.filename.removeSuffix("-diagram.html").takeIf { rf.filename.endsWith("-diagram.html") }
                val dataLinkHtml = stem?.let { """ <a class="data" href="${Html.attribute("$it-report.json")}">JSON</a>""" }.orEmpty()
                val countsHtml =
                    if (c.total == 0) {
                        "<span class=\"none\">—</span>"
                    } else {
                        listOf("success" to c.success, "warn" to c.warn, "error" to c.error)
                            .filter { it.second > 0 }
                            .joinToString(
                                " ",
                            ) { (s, n) ->
                                """<span class="count ${Html.attribute(
                                    s,
                                )}">${Html.text("${statusIcon(s)} $n ${statusText(s).lowercase()}")}</span>"""
                            }
                    }
                """
                <tr data-status="${Html.attribute(rf.status)}" data-title="${Html.attribute(rf.title.lowercase())}">
                  <td><span class="badge ${Html.attribute(
                    rf.status,
                )}"><span aria-hidden="true">${Html.text(statusIcon(rf.status))}</span> ${Html.text(statusText(rf.status))}</span></td>
                  <th scope="row"><a href="${Html.attribute(rf.filename)}">${Html.text(rf.title)}</a>$dataLinkHtml</th>
                  <td class="num">${Html.text(c.total.toString())}</td>
                  <td>$countsHtml</td>
                </tr>
                """.trimIndent()
            }
        val summary =
            "${reportFiles.size} report${if (reportFiles.size == 1) "" else "s"} · ${totals.total} scenario${if (totals.total == 1) "" else "s"}: " +
                "${totals.success} passed, ${totals.warn} with warnings, ${totals.error} failed"
        return """
            <!DOCTYPE html>
            <html lang="en" data-theme="dark">
            <head>
              <meta charset="UTF-8"/>
              <meta name="viewport" content="width=device-width, initial-scale=1"/>
              <meta name="color-scheme" content="dark light"/>
              <script>
                try {
                  var t = localStorage.getItem('lsd-report-theme')
                  if (t !== 'dark' && t !== 'light' && t !== 'contrast') {
                    t = matchMedia('(prefers-contrast: more)').matches ? 'contrast'
                      : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
                  }
                  document.documentElement.setAttribute('data-theme', t)
                } catch (e) {}
              </script>
              <title>LSD Mono reports</title>
              <style>
                :root, [data-theme="dark"] { color-scheme: dark; --bg: oklch(0.16 0.02 250); --surface: oklch(0.23 0.028 250);
                  --border: oklch(0.35 0.03 250 / 0.7); --text: oklch(0.95 0.01 250); --muted: oklch(0.72 0.02 250);
                  --accent: oklch(0.82 0.16 175); --success: oklch(0.72 0.17 150); --warn: oklch(0.82 0.14 85); --error: oklch(0.74 0.17 25); }
                [data-theme="light"] { color-scheme: light; --bg: oklch(0.97 0.01 250); --surface: oklch(1 0 0);
                  --border: oklch(0.88 0.015 250); --text: oklch(0.22 0.03 250); --muted: oklch(0.42 0.025 250);
                  --accent: oklch(0.45 0.12 175); --success: oklch(0.46 0.13 150); --warn: oklch(0.48 0.12 80); --error: oklch(0.48 0.17 25); }
                [data-theme="contrast"] { color-scheme: light; --bg: #fff; --surface: #fff; --border: #000; --text: #000; --muted: #000;
                  --accent: #000; --success: #064e3b; --warn: #78350f; --error: #7f1d1d; }
                * { box-sizing: border-box; }
                body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.5;
                  font: 15px/1.5 "Inter", "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
                main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
                h1 { font-size: 1.6rem; margin: 0 0 4px; }
                .summary { color: var(--muted); margin: 0 0 16px; }
                .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
                #filter { flex: 1 1 240px; min-width: 0; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--border);
                  background: var(--surface); color: var(--text); font: inherit; }
                .tools label { display: inline-flex; gap: 6px; align-items: center; color: var(--muted); white-space: nowrap; }
                a { color: var(--accent); }
                a:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
                table { border-collapse: collapse; width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; }
                caption { text-align: left; padding: 0 0 8px; color: var(--muted); }
                th, td { border-bottom: 1px solid var(--border); padding: 10px 12px; text-align: left; vertical-align: top; }
                thead th { color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; }
                tbody th { font-weight: 600; }
                tr:last-child > * { border-bottom: 0; }
                .num { text-align: right; font-variant-numeric: tabular-nums; }
                .badge { display: inline-block; white-space: nowrap; padding: 1px 10px; border-radius: 999px; border: 1px solid currentColor; font-size: .85rem; font-weight: 600; }
                .badge.success, .count.success { color: var(--success); }
                .badge.warn, .count.warn { color: var(--warn); }
                .badge.error, .count.error { color: var(--error); }
                .count { white-space: nowrap; margin-right: 8px; font-size: .9rem; }
                .data { margin-left: 8px; font-weight: 400; font-size: .85rem; color: var(--muted); }
                .none, .empty { color: var(--muted); }
                [data-theme="contrast"] table, [data-theme="contrast"] .badge { border-width: 2px; }
                @media (max-width: 560px) {
                  main { padding: 16px 10px 32px; }
                  thead { display: none; }
                  table, caption, tbody, tr, th, td { display: block; width: 100%; }
                  caption { padding: 8px 12px; }
                  tr { border-bottom: 1px solid var(--border); padding: 8px 0; }
                  th, td { border: 0; padding: 2px 12px; }
                  td.num { display: none; }
                }
              </style>
            </head>
            <body>
              <main>
                <h1>LSD Mono reports</h1>
                <p class="summary" id="summary">${Html.text(summary)}</p>
                <div class="tools">
                  <input type="search" id="filter" placeholder="Filter reports by title" aria-label="Filter reports by title" autocomplete="off"/>
                  <label><input type="checkbox" id="failed-only"$failedOnlyStateHtml/> Failed only (${Html.text(failedReports.toString())})</label>
                </div>
                <table>
                  <caption>Failed reports first. Each title opens that report's sequence diagrams.</caption>
                  <thead><tr><th scope="col">Status</th><th scope="col">Report</th><th scope="col" class="num">Scenarios</th><th scope="col">Outcomes</th></tr></thead>
                  <tbody>
                  $rowsHtml
                  </tbody>
                </table>
                <p class="empty" id="no-match" hidden>No reports match the filter.</p>
              </main>
              <script>
                (function () {
                  var filter = document.getElementById('filter')
                  var failed = document.getElementById('failed-only')
                  var rows = Array.prototype.slice.call(document.querySelectorAll('tbody tr'))
                  function apply() {
                    var q = filter.value.trim().toLowerCase()
                    var shown = 0
                    rows.forEach(function (row) {
                      var ok = (!q || row.getAttribute('data-title').indexOf(q) >= 0) &&
                        (!failed.checked || row.getAttribute('data-status') === 'error')
                      row.hidden = !ok
                      if (ok) shown++
                    })
                    document.getElementById('no-match').hidden = shown > 0
                  }
                  filter.addEventListener('input', apply)
                  failed.addEventListener('change', apply)
                })()
              </script>
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
                setProperty("format", INDEX_FORMAT)
                setProperty("success", entry.counts.success.toString())
                setProperty("warn", entry.counts.warn.toString())
                setProperty("error", entry.counts.error.toString())
                entry.stem?.let { setProperty("stem", it) }
                entry.dataScript?.let { setProperty("data", it) }
                setProperty("scenarios", entry.scenarios.size.toString())
                entry.scenarios.forEachIndexed { i, s ->
                    setProperty("scenario.$i.id", s.id)
                    setProperty("scenario.$i.title", Html.wellFormed(s.title))
                    setProperty("scenario.$i.status", s.status)
                    setProperty("scenario.$i.messages", s.messages.toString())
                }
            }
        val text = StringWriter().also { props.store(it, null) }.toString()
        val file = dir.resolve(entry.filename.removeSuffix(".html") + ".properties")
        writeAtomically(file, text)
        // A rewrite in the same second with the same size would otherwise look unchanged.
        jvmIndexLock.withLock { entryCache.remove(file.toFile().absolutePath) }
    }

    /**
     * Parsed index entries, per entry file, kept while the file's size and modified time are
     * unchanged. `createIndex` runs once per test class, so without this a suite of N classes
     * would parse N entries N times. Only read and written under [withIndexLock].
     */
    private val entryCache = HashMap<String, CachedEntry>()

    private class CachedEntry(
        val modified: Long,
        val size: Long,
        val entry: ReportFile?,
    )

    private fun readIndexEntries(outputDir: File): List<ReportFile> {
        val dir = outputDir.resolve(INDEX_DIR)
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".properties") } ?: return emptyList()
        val seen = HashSet<String>()
        val entries =
            files.mapNotNull { file ->
                val key = file.absolutePath
                seen += key
                val modified = file.lastModified()
                val size = file.length()
                val cached = entryCache[key]?.takeIf { it.modified == modified && it.size == size }
                val entry = cached?.entry ?: if (cached != null) null else parseEntry(file).also { entryCache[key] = CachedEntry(modified, size, it) }
                // An entry whose report was deleted is stale.
                entry?.takeIf { outputDir.resolve(it.filename).exists() }
            }
        val prefix = dir.absolutePath + File.separator
        entryCache.keys.removeIf { it.startsWith(prefix) && it !in seen }
        return entries
    }

    private fun parseEntry(file: File): ReportFile? {
        val props = Properties()
        runCatching { file.reader(Charsets.UTF_8).use { props.load(it) } }.getOrNull() ?: return null
        // Entries from an older version name a page this version no longer links to.
        if (props.getProperty("format") != INDEX_FORMAT) return null
        val filename = props.getProperty("filename") ?: return null

        fun count(key: String) = props.getProperty(key)?.toIntOrNull() ?: 0
        return ReportFile(
            filename,
            props.getProperty("title").orEmpty(),
            props.getProperty("status").orEmpty(),
            ScenarioCounts(count("success"), count("warn"), count("error")),
            stem = props.getProperty("stem"),
            dataScript = props.getProperty("data"),
            scenarios =
                (0 until count("scenarios")).mapNotNull { i ->
                    val id = props.getProperty("scenario.$i.id") ?: return@mapNotNull null
                    IndexScenario(
                        id = id,
                        title = props.getProperty("scenario.$i.title").orEmpty(),
                        status = props.getProperty("scenario.$i.status").orEmpty(),
                        messages = props.getProperty("scenario.$i.messages")?.toIntOrNull() ?: 0,
                    )
                },
        )
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

    /**
     * Write to a temporary file beside [target], then move it into place. The temporary file
     * is created like any other new file, so it gets the usual mode under the umask (`0644`
     * under `022`) and the report is readable by others. `Files.createTempFile` would make it
     * owner-only (`0600`), and the move keeps that mode.
     */
    internal fun writeAtomically(target: Path, text: String) {
        val dir = target.toAbsolutePath().parent
        Files.createDirectories(dir)
        // Lone surrogates are escaped or replaced before this; never fail a report on one that is not.
        val bytes = Html.wellFormed(text).toByteArray(Charsets.UTF_8)
        val temp = createTemp(dir, target.fileName.toString(), bytes)
        try {
            try {
                Files.move(temp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING)
            }
        } finally {
            Files.deleteIfExists(temp)
        }
    }

    /** A new file `.<name>.<random>.tmp` in [dir] holding [bytes]; `CREATE_NEW`, so never someone else's file. */
    private fun createTemp(dir: Path, name: String, bytes: ByteArray): Path {
        while (true) {
            val temp = dir.resolve(".$name.${UUID.randomUUID()}.tmp")
            try {
                Files.newOutputStream(temp, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE).use { it.write(bytes) }
                return temp
            } catch (_: FileAlreadyExistsException) {
                continue
            } catch (e: Exception) {
                Files.deleteIfExists(temp)
                throw e
            }
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

    /**
     * `<stem>-report.js`: a classic script that adds this report to `window.__LSD_REPORTS__`
     * under its stem. The index page adds it with a script element when the report is opened,
     * which works from `file://`, where fetch does not. Payloads stay in `<stem>-payloads.js`.
     */
    internal fun reportDataScript(stem: String, report: ReportJson, payloadsSrc: String?): String {
        val payloads = if (payloadsSrc == null) "null" else jsonString(payloadsSrc)
        return "(window.__LSD_REPORTS__=window.__LSD_REPORTS__||{})[${jsonString(stem)}]=" +
            "{report:${report.toJson().trim()},payloadsSrc:$payloads};\n"
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
