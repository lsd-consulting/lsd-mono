package io.github.lsdconsulting.lsd.mono.report.html

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * The bundled page carries its own version (ui/src/lib/viewer-version.ts), the project version: its
 * version chip and usage ping use it, the same whatever wrote the data.
 */
class ViewerVersionTest {
    @Test
    fun `the bundled page is stamped with the project version`() {
        val projectVersion = System.getProperty("lsd.mono.test.projectVersion") ?: error("Gradle sets the project version")
        val shell =
            ViewerVersionTest::class.java
                .getResourceAsStream("/lsd-mono-report-html/lsd-report.single.html")
                ?.use { it.readBytes().toString(Charsets.UTF_8) }
                ?: error("the shell is on the test classpath")
        // The minified bundle assigns VIEWER_VERSION as a quoted literal (`var e=`0.16.0``), with ", ' or `.
        // Requiring the assignment, not just the string, keeps a coincidental match (such as a
        // dependency's version string) from passing.
        val assigned = Regex("""[\w$]+\s*=\s*["'`]${Regex.escape(projectVersion)}["'`]""")
        assertTrue(assigned.containsMatchIn(shell), "shell assigns the literal $projectVersion")
        assertFalse(shell.contains("__LSD_VIEWER_VERSION__"), "the build replaced the placeholder")
    }
}
