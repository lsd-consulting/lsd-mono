package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.live.LiveFrames
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import java.util.zip.ZipFile
import kotlin.io.path.extension
import kotlin.io.path.invariantSeparatorsPathString
import kotlin.io.path.isRegularFile
import kotlin.io.path.name
import kotlin.io.path.readText
import kotlin.reflect.KVisibility
import kotlin.reflect.full.declaredMemberProperties
import kotlin.reflect.full.findAnnotation

/**
 * Keeps live capture to LSD Studio marked experimental (#152), on the compiled classes:
 *
 * 1. [ExperimentalLsdStudioApi] requires opt-in at WARNING, survives into consumers' classpaths,
 *    and targets classes, functions and properties.
 * 2. Every public Studio declaration carries it: [LsdProperties.STUDIO_URL], and anything public
 *    in the `jvm.live` package (today none: it is all internal).
 * 3. The public Studio symbols in the API dump are exactly those.
 * 4. Only an allow-list of internal files opts in, and no build script opts in for a module.
 * 5. The docs mark the Studio property and the README section experimental.
 */
@OptIn(ExperimentalLsdStudioApi::class)
class ExperimentalStudioApiGuardTest {
    private val repo: Path = Path.of("../..").toAbsolutePath().normalize()

    @Test
    fun `the marker requires opt-in at WARNING and is kept in the class file`() {
        val marker = ExperimentalLsdStudioApi::class
        val bytes = javaClass.classLoader
            .getResourceAsStream(marker.java.name.replace('.', '/') + ".class")!!
            .use { it.readBytes() }
            .toString(Charsets.ISO_8859_1)
        // RequiresOptIn is BINARY: in the class file, not visible to reflection.
        assertTrue(bytes.contains("Lkotlin/RequiresOptIn;"), "annotated with RequiresOptIn")
        assertTrue(bytes.contains("Lkotlin/RequiresOptIn\$Level;") && bytes.contains("WARNING"), "at level WARNING")
        assertEquals(AnnotationRetention.RUNTIME, marker.findAnnotation<Retention>()?.value)
        val targets = marker
            .findAnnotation<Target>()
            ?.allowedTargets
            .orEmpty()
            .toSet()
        assertTrue(
            targets.containsAll(setOf(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION, AnnotationTarget.PROPERTY)),
            "targets $targets",
        )
    }

    @Test
    fun `every public Studio declaration is marked, and the API dump lists exactly those`() {
        val studioUrl = LsdProperties::class.declaredMemberProperties.single { it.name == "STUDIO_URL" }
        assertTrue(studioUrl.annotations.any(::isMarker), "STUDIO_URL is marked")

        val publicLive =
            liveClasses()
                .map { Class.forName(it, false, javaClass.classLoader).kotlin }
                .filter { runCatching { it.visibility }.getOrNull() == KVisibility.PUBLIC }
        val unmarked = publicLive.filter { k -> k.annotations.none(::isMarker) }
        assertEquals(emptyList<String>(), unmarked.map { it.qualifiedName }, "public jvm.live classes without the marker")

        val dump = Path.of("api/lsd-mono-jvm.api").readText().lines()
        val dumped =
            dump.filter { it.contains("/jvm/live/") && it.startsWith("public") }.map { it.substringAfter(" class ").substringBefore(" ") } +
                dump.filter { it.contains("field STUDIO_URL ") }.map { "STUDIO_URL" }
        val marked = publicLive.map { it.java.name.replace('.', '/') } + "STUDIO_URL"
        assertEquals(marked.sorted(), dumped.sorted())
    }

    @Test
    fun `only the allow-listed files opt in, and no build script does`() {
        val optIns =
            sources { it.extension == "kt" && "/src/main/" in it.invariantSeparatorsPathString }
                .filter { file -> file.readText().lines().any { it.trim().startsWith("@OptIn(ExperimentalLsdStudioApi::class)") } }
                .map { repo.relativize(it).invariantSeparatorsPathString }
        assertEquals(ALLOWED_OPT_INS.sorted(), optIns.sorted())
        val scripts = sources { it.name.endsWith(".gradle.kts") }.filter { it.readText().contains("ExperimentalLsdStudioApi") }
        assertEquals(emptyList<Path>(), scripts, "build scripts that opt in")
    }

    @Test
    fun `the docs mark the Studio property and the live capture section experimental`() {
        val row =
            repo
                .resolve("docs/jvm-api.md")
                .readText()
                .lines()
                .single { it.startsWith("| `${LsdProperties.STUDIO_URL}` |") }
        assertTrue(row.contains("Experimental"), row)
        val readme = Path.of("README.md").readText()
        assertTrue(readme.contains("## Live capture to LSD Studio (experimental)"))
        assertTrue(readme.contains("`LsdProperties.STUDIO_URL` is marked `@ExperimentalLsdStudioApi`"))
    }

    // `is ExperimentalLsdStudioApi` is not allowed for an opt-in marker, so compare names.
    private fun isMarker(annotation: Annotation): Boolean = annotation.annotationClass.qualifiedName == MARKER

    /** The jvm.live classes' names, nested and synthetic ones aside. */
    private fun liveClasses(): List<String> {
        // The tests run against the jar, or the classes directory.
        val location = Path.of(
            LiveFrames::class.java.protectionDomain.codeSource.location
                .toURI(),
        )
        val prefix = "io/github/lsdconsulting/lsd/mono/jvm/live/"
        val entries =
            if (Files.isDirectory(location)) {
                Files.walk(location).use { paths -> paths.map { location.relativize(it).invariantSeparatorsPathString }.toList() }
            } else {
                ZipFile(location.toFile()).use { zip -> zip.entries().toList().map { it.name } }
            }
        val names = entries.filter { it.startsWith(prefix) && '/' !in it.removePrefix(prefix) }.map { it.removePrefix(prefix) }
        assertTrue(names.isNotEmpty())
        return names.filter { it.endsWith(".class") && '$' !in it }.map { "io.github.lsdconsulting.lsd.mono.jvm.live." + it.removeSuffix(".class") }
    }

    private fun sources(keep: (Path) -> Boolean): List<Path> =
        Files.walk(repo.resolve("modules")).use { paths ->
            paths
                .filter { it.isRegularFile() && "/build/" !in it.invariantSeparatorsPathString && "/node_modules/" !in it.invariantSeparatorsPathString }
                .filter(keep)
                .toList()
        } +
            Files.walk(repo.resolve("build-logic")).use { paths ->
                paths.filter { it.isRegularFile() && "/build/" !in it.invariantSeparatorsPathString && keep(it) }.toList()
            } + listOf(repo.resolve("build.gradle.kts")).filter(keep)

    private companion object {
        const val MARKER = "io.github.lsdconsulting.lsd.mono.jvm.ExperimentalLsdStudioApi"

        val ALLOWED_OPT_INS =
            listOf(
                "modules/lsd-mono-jvm/src/main/kotlin/io/github/lsdconsulting/lsd/mono/jvm/properties/LsdKey.kt",
                "modules/lsd-mono-jvm/src/main/kotlin/io/github/lsdconsulting/lsd/mono/jvm/properties/LsdProperties.kt",
            )
    }
}
