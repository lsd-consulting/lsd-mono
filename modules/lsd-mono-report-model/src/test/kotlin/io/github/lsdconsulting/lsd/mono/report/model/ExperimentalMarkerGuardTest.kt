package io.github.lsdconsulting.lsd.mono.report.model

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import kotlin.io.path.createDirectories
import kotlin.io.path.createTempDirectory
import kotlin.io.path.deleteRecursively
import kotlin.io.path.exists
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString
import kotlin.io.path.readText
import kotlin.io.path.writeText

/**
 * Every public top-level declaration in lsd-mono-report-model and lsd-mono-report-html carries
 * [ExperimentalLsdReportModel] (#118). Nothing else would notice a missing marker: the ABI dumps do
 * not record annotations, the modules opt in module-wide, and BINARY retention keeps the marker
 * from reflection. So the main sources are scanned. explicitApi() makes every public declaration
 * say `public`, which is what the scan looks for.
 */
class ExperimentalMarkerGuardTest {
    @Test
    fun `every public top-level declaration is marked experimental`() {
        val findings =
            guardedSources().flatMap { (path, source) ->
                Declarations(source).public().filterNot { it.marked }.filterNot { it.name in UNMARKED }.map {
                    "$path:${it.line}: ${it.name} is public but not @ExperimentalLsdReportModel"
                }
            }
        assertEquals(emptyList<String>(), findings)
    }

    @Test
    fun `the scan skips node_modules, build and hidden folders and missing roots`() {
        val root = createTempDirectory("guard")
        try {
            for (path in listOf(
                "src/main/A.kt",
                "src/main/ui/node_modules/.vitest-cache/B.kt",
                "src/main/build/C.kt",
                "src/main/.cache/D.kt",
                "src/main/E.txt",
            )) {
                root.resolve(path).also { it.parent.createDirectories() }.writeText("x")
            }
            val paths = kotlinSources(root, listOf(root.resolve("src/main"), root.resolve("gone"))).map { it.first }
            assertEquals(listOf("src/main/A.kt"), paths)
        } finally {
            @OptIn(kotlin.io.path.ExperimentalPathApi::class)
            root.deleteRecursively()
        }
    }

    @Test
    fun `the scan finds the model and the writer`() {
        val names = guardedSources().flatMap { (_, source) -> Declarations(source).public().map { it.name } }
        for (name in listOf("FactJson", "ScenarioJson", "KnownReportSource", "ReportWriter", "ReportWriterSettings", "WrittenReport")) {
            assertTrue(name in names, "the scan did not find $name")
        }
    }

    @Test
    fun `the scanner reads markers above a declaration, not above the one before it`() {
        val source =
            """
            |/** A [Thing]. */
            |@ExperimentalLsdReportModel
            |public data class A(val a: String)
            |public class B
            |
            |@Suppress(
            |    "unused",
            |)
            |@ExperimentalLsdReportModel
            |public object C
            |
            |@ExperimentalLsdReportModel public fun d(): Int = 1
            |
            |/**
            | * @ExperimentalLsdReportModel in a comment is not a marker.
            | */
            |public val e: Int = 2
            |internal class F
            |private fun g() {
            |    public class H
            |}
            """.trimMargin()
        assertEquals(
            listOf("A" to true, "B" to false, "C" to true, "d" to true, "e" to false),
            Declarations(source).public().map { it.name to it.marked },
        )
    }

    private class Declaration(val name: String, val line: Int, val marked: Boolean)

    /** Top-level public declarations, each with whether its own annotations include the marker. */
    private class Declarations(source: String) {
        private val lines = source.lines()

        fun public(): List<Declaration> = lines.indices.mapNotNull { i ->
            val match = PUBLIC_TOP_LEVEL.find(lines[i]) ?: return@mapNotNull null
            Declaration(match.groupValues[2], i + 1, MARKER in match.groupValues[1] || annotationsAbove(i).any { it.trim() == MARKER })
        }

        /**
         * The lines of the annotations directly above line [i]: lines that start with `@`, and the
         * indented or closing lines of a multi-line annotation's arguments. Stops at a blank line, a
         * KDoc or the previous declaration.
         */
        private fun annotationsAbove(i: Int): List<String> {
            val above = mutableListOf<String>()
            var j = i - 1
            while (j >= 0) {
                val line = lines[j]
                val annotationPart = line.startsWith("@") || line.startsWith(")") || (line.startsWith(" ") && !line.trimStart().startsWith("*"))
                if (line.isBlank() || !annotationPart) break
                above += line
                j--
            }
            return above
        }
    }

    private companion object {
        const val MARKER = "@ExperimentalLsdReportModel"

        /** Public and unmarked on purpose: the marker itself. */
        val UNMARKED = setOf("ExperimentalLsdReportModel")

        const val MODIFIERS = "data|sealed|enum|annotation|abstract|open|inline|value|const|fun|operator|infix|tailrec|suspend"

        val PUBLIC_TOP_LEVEL =
            Regex(
                """^((?:@[\w.]+(?:\([^)]*\))?\s+)*)public\s+(?:(?:$MODIFIERS)\s+)*""" +
                    """(?:class|interface|object|fun|val|var|typealias)\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(\w+)""",
            )

        val GUARDED = Regex("""modules/lsd-mono-report-(model|html)/src/main/.*""")

        /** (path relative to the repository, text) for report-model's and report-html's main Kotlin. */
        fun guardedSources(): List<Pair<String, String>> {
            var root = Path.of("").toAbsolutePath()
            while (!root.resolve("settings.gradle.kts").exists()) root = root.parent
            return kotlinSources(root, listOf("model", "html").map { root.resolve("modules/lsd-mono-report-$it/src/main") })
                .filter { (path, _) -> GUARDED.matches(path) }
        }

        /** Folders the scan never enters: other tools write and delete files there while tests run (#171). */
        fun skipped(dir: Path): Boolean {
            val name = dir.fileName?.toString() ?: return false
            return name == "node_modules" || name == "build" || name.startsWith(".")
        }

        /**
         * (path relative to [root], text) for every .kt file under [starts], sorted. Skips [skipped]
         * folders, and a file or folder that vanishes between listing and reading is left out rather
         * than failing the scan.
         */
        fun kotlinSources(root: Path, starts: List<Path>): List<Pair<String, String>> {
            val found = mutableListOf<Pair<String, String>>()
            for (start in starts.filter { it.exists() }) {
                Files.walkFileTree(
                    start,
                    object : SimpleFileVisitor<Path>() {
                        override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult =
                            if (dir != start && skipped(dir)) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE

                        override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                            if (attrs.isRegularFile && file.extension == "kt") {
                                try {
                                    found += root.relativize(file).invariantSeparatorsPathString to file.readText()
                                } catch (_: NoSuchFileException) {
                                    // Deleted after it was listed.
                                }
                            }
                            return FileVisitResult.CONTINUE
                        }

                        override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult =
                            if (exc is NoSuchFileException) FileVisitResult.CONTINUE else throw exc
                    },
                )
            }
            return found.sortedBy { it.first }
        }
    }
}
