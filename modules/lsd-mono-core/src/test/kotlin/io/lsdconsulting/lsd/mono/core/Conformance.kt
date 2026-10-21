package io.lsdconsulting.lsd.mono.core

import org.junit.jupiter.api.Assertions.assertEquals
import java.nio.file.Path
import kotlin.io.path.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText

/**
 * The shared test reports in `modules/lsd-mono-report-schema/conformance`, which the report UI's
 * tests read too. Gradle runs the tests in the module directory, and the directory is one of the
 * test task's inputs.
 */
internal object Conformance {
    val DIR: Path = Path("../lsd-mono-report-schema/conformance")

    fun read(file: String): String = DIR.resolve(file).readText()

    /**
     * Fails unless [actual] is the corpus file [file], byte for byte. On a difference it writes
     * [actual] to `build/conformance-actual/<file>`, to copy over when the change is intended.
     */
    fun assertMatches(
        file: String,
        actual: String,
    ) {
        val expected = DIR.resolve(file).takeIf { it.exists() }?.readText()
        if (expected != actual) {
            val out = Path("build/conformance-actual").resolve(file)
            out.parent.createDirectories()
            out.writeText(actual)
        }
        assertEquals(expected, actual, "copy build/conformance-actual/$file to ${DIR.resolve(file).normalize()} when the change is intended")
    }
}
