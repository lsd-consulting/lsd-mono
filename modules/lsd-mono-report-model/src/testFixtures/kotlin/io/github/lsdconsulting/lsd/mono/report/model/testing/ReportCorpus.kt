package io.github.lsdconsulting.lsd.mono.report.model.testing

/**
 * The shared test reports in `modules/lsd-mono-report-schema/conformance`, read from the
 * classpath like the schemas ([ReportSchemas.RESOURCES]). The build lists the directory's files in
 * `conformance/files.txt` beside them, as a classpath has no directory listing.
 */
public object ReportCorpus {
    /** Every file in the corpus directory, as paths relative to it with `/` separators, sorted. */
    public val files: List<String> by lazy { ReportSchemas.read("conformance/files.txt").lines().filter { it.isNotEmpty() } }

    /** The text of the corpus file [file], such as `reports/minimal.json`. */
    public fun read(file: String): String = ReportSchemas.read("conformance/$file")

    /** Whether the corpus has a file [file]. */
    public fun has(file: String): Boolean = file in files
}
