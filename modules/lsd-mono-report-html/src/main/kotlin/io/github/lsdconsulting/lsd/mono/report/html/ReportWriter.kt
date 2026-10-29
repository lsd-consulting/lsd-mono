package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.MessageEventJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportJson
import io.github.lsdconsulting.lsd.mono.report.model.ReportSchema
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
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Properties
import java.util.UUID
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Writes a [ReportJson] as files: `<stem>-report.json` (the report), `<stem>-diagram.html` (the
 * interactive report page: the single-file shell bundled in this jar, with the report injected as
 * `window.__LSD_REPORT__`), `<stem>-report.js` (the report for the index page to load) and, when
 * messages carry data, `<stem>-payloads.js`, which the page loads when the inspector opens.
 * [writeIndex] writes `index.html`, which lists every report in the directory.
 *
 * ```kotlin
 * val writer = ReportWriter(ReportWriterSettings(generator = "my-adapter 1.0"))
 * val written = writer.writeReport(report, File("build/reports/lsd"))
 * writer.writeIndex(File("build/reports/lsd"))
 * ```
 *
 * **Several writers, one directory.** Test classes, parallel tests, Gradle forks
 * and modules can share an output directory:
 * - Each report's files start with one stem, `<sanitised title>-<8 hex chars>`: the title plus a short
 *   hash of the report key (or the title), so two reports never share a file.
 * - Every file is written to a temporary file and moved into place, so a reader
 *   never sees half a file and concurrent writers do not interleave.
 * - Each report also leaves a small entry under `.lsd-index/`. [writeIndex] lists
 *   every entry in the directory, under a file lock, so the index from any writer
 *   includes the reports of all the others.
 * - There are no shared "latest" files (`report.json`, `lsd-report.single.html`).
 *
 * The writer reads no properties: what it adds itself, the index page's generator, time and
 * usage-ping switch, comes in [settings]. The index lock and the parsed index entries are shared
 * by every writer in the JVM.
 */
public class ReportWriter(
    private val settings: ReportWriterSettings,
) {
    /**
     * Write one report. File names start with the report's stem: the title plus a hash of
     * [reportKey] (a test class or feature id) when given, else of the title, so
     * reports with the same title do not collide. [fileTitle] stands in for the title in the
     * file names when an integration names its files apart from the title it shows.
     * @return the files written, for [writeIndex].
     */
    @JvmOverloads
    public fun writeReport(
        report: ReportJson,
        outputDir: File,
        reportKey: String? = null,
        fileTitle: String = report.title,
    ): WrittenReport {
        outputDir.mkdirs()
        val stem = reportFileStem(fileTitle, reportKey)
        val jsonName = "$stem-report.json"
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
        val entry = indexEntry(report, reportKey, fileTitle)
        writeIndexEntry(outputDir, entry)
        return WrittenReport(diagramHtml = diagramPath, reportJson = jsonPath, entry = entry)
    }

    /** What the index lists for a report written with [writeReport]. */
    internal fun indexEntry(
        report: ReportJson,
        reportKey: String? = null,
        fileTitle: String = report.title,
    ): ReportFile {
        val stem = reportFileStem(fileTitle, reportKey)
        return ReportFile(
            filename = "$stem-diagram.html",
            title = report.title,
            status = report.status.json,
            counts = ScenarioCounts.of(report.scenarios.map { it.status.json }),
            stem = stem,
            dataScript = "$stem-report.js",
            scenarios = report.scenarios.map { IndexScenario(it.id, it.title, it.status.json, it.events.count { e -> e is MessageEventJson }) },
        )
    }

    /**
     * Write `index.html` in [outputDir], listing every report any writer has written there, and
     * [reports] as well: failed reports first, then by title. Safe to call from several threads and
     * processes at once.
     * @return the index page.
     */
    @JvmOverloads
    public fun writeIndex(
        outputDir: File,
        reports: List<WrittenReport> = emptyList(),
    ): Path = writeIndexOf(reports.map { it.entry }, outputDir)

    /** [writeIndex], with entries that need not have been written: a link-only entry has no stem. */
    internal fun writeIndexOf(
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

    /**
     * The index page: the report shell with a manifest of every report in
     * `window.__LSD_INDEX__`. Each report's data loads from its `<stem>-report.js` when it is
     * opened, so the page stays small however many reports the directory holds.
     */
    internal fun renderIndex(reportFiles: List<ReportFile>): String {
        val manifest =
            JsonObject(
                listOf(
                    "schemaVersion" to JsonString(ReportSchema.VERSION),
                    "title" to JsonString(INDEX_TITLE),
                    "generatedAt" to JsonString((settings.generatedAt ?: Instant.now()).truncatedTo(ChronoUnit.MILLIS).toString()),
                    "generator" to JsonString(settings.generator),
                    "options" to JsonObject(listOf("usagePing" to JsonBool(settings.usagePing))),
                    "reports" to JsonArray(reportFiles.map(::manifestEntry)),
                ),
            )
        return injectIntoShell("<script>window.__LSD_INDEX__=${manifest.render().trim()};</script>\n")
            .replaceFirst(Regex("<title>[^<]*</title>"), "<title>${Html.text(INDEX_TITLE)}</title>")
    }

    private fun manifestEntry(rf: ReportFile): JsonValue {
        val id = rf.stem ?: rf.filename
        val fields =
            mutableListOf<Pair<String, JsonValue>>(
                "id" to JsonString(id),
                "title" to JsonString(rf.title),
                "status" to JsonString(rf.status),
                "href" to JsonString(rf.filename),
                "counts" to
                    JsonObject(
                        listOf(
                            "success" to JsonNumber(rf.counts.success.toString()),
                            "warn" to JsonNumber(rf.counts.warn.toString()),
                            "error" to JsonNumber(rf.counts.error.toString()),
                        ),
                    ),
                "scenarios" to
                    JsonArray(
                        rf.scenarios.map {
                            JsonObject(
                                listOf(
                                    "id" to JsonString(it.id),
                                    "title" to JsonString(it.title),
                                    "status" to JsonString(it.status),
                                    "messages" to JsonNumber(it.messages.toString()),
                                ),
                            )
                        },
                    ),
            )
        rf.dataScript?.let { fields.add(4, "data" to JsonString(it)) }
        return JsonObject(fields)
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
        val src =
            if (payloadsFile == null)
                ""
            else
                "window.__LSD_PAYLOADS_SRC__=${jsonString(payloadsFile)};"
        return injectIntoShell("<script>${src}window.__LSD_REPORT__=${report.toJson().trim()};</script>\n")
    }

    /** The packaged shell with [injection] placed before its first script. */
    private fun injectIntoShell(injection: String): String {
        val template = readShellTemplate()
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

    public companion object {
        private const val SHELL_RESOURCE = "/lsd-mono-report-html/lsd-report.single.html"
        private const val INDEX_DIR = ".lsd-index"
        private const val INDEX_LOCK = ".lock"
        private const val INDEX_FORMAT = "2"
        private const val INDEX_TITLE = "LSD reports"
        private const val MAX_TITLE_CHARS = 80
        private val jvmIndexLock = ReentrantLock()
        private val STATUS_ORDER = listOf("error", "warn", "success")

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

        /**
         * File-name stem for a report: `<sanitised title>-<8 hex chars>`. The hash is of
         * [reportKey] when given, else of [title], so it is stable across runs and two
         * titles that sanitise to the same text still get different files.
         */
        internal fun reportFileStem(
            title: String,
            reportKey: String? = null,
        ): String = "${sanitizeFilename(title)}-${shortHash(reportKey ?: title)}"

        /**
         * [report] as the JSON text [writeReport] writes to `<stem>-report.json`, with
         * `schemaVersion` set to [ReportSchema.VERSION].
         */
        @JvmStatic
        public fun toJson(report: ReportJson): String = report.toJson()

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
    }
}
