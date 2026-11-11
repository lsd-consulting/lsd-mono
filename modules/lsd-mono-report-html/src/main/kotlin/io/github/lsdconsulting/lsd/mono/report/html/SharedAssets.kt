package io.github.lsdconsulting.lsd.mono.report.html

import java.security.MessageDigest

/**
 * The report app as separate files, for [ReportAssets.SHARED] (#64): the page template and the
 * script and styles it loads, as this jar packages them (built by ui/scripts/inline-single.mjs).
 * Each file is written under a name with a hash of its content, `lsd-report-<16 hex>.js`.
 */
internal class SharedAssets private constructor(
    val page: String,
    val script: Asset,
    val styles: Asset,
) {
    class Asset(
        val name: String,
        val text: String,
    ) {
        /** Its size in bytes as written (UTF-8). */
        val size: Long = Html
            .wellFormed(text)
            .toByteArray(Charsets.UTF_8)
            .size
            .toLong()
    }

    companion object {
        private const val DIR = "/lsd-mono-report-html/"

        /** What the template links to; the writer puts the hashed names in. */
        const val STYLES_HREF: String = "href=\"lsd-report.css\""
        const val SCRIPT_TAG: String = "<script src=\"lsd-report.js\"></script>"

        /** Read once: the jar's files do not change while it runs. */
        val packaged: SharedAssets by lazy { load() }

        private fun load(): SharedAssets {
            val page = resource("lsd-report.shared.html")
            check(STYLES_HREF in page && SCRIPT_TAG in page) { "${DIR}lsd-report.shared.html does not link lsd-report.css and lsd-report.js" }
            val script = resource("shared/lsd-report.js")
            check("window.__LSD_REPORT__??" in script) { "${DIR}shared/lsd-report.js does not read window.__LSD_REPORT__" }
            return SharedAssets(page, asset("js", script), asset("css", resource("shared/lsd-report.css")))
        }

        private fun asset(extension: String, text: String) = Asset("lsd-report-${contentHash(text)}.$extension", text)

        internal fun contentHash(text: String): String =
            MessageDigest
                .getInstance("SHA-256")
                .digest(text.toByteArray(Charsets.UTF_8))
                .take(8)
                .joinToString("") { "%02x".format(it) }

        private fun resource(name: String): String =
            (SharedAssets::class.java.getResourceAsStream(DIR + name) ?: error("Missing classpath resource $DIR$name"))
                .bufferedReader()
                .use { it.readText() }
    }
}
