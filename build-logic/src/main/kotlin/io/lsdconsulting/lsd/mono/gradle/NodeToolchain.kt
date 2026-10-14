package io.lsdconsulting.lsd.mono.gradle

import org.gradle.api.tasks.Exec
import java.io.File

/*
 * The report build (Vite, Vitest, Playwright, `--experimental-strip-types`) needs Node 22.6 or
 * later (`engines` in report/package.json). CI uses the Node major in the repo's `.nvmrc`
 * (`node-version-file` in the workflows), so these helpers prefer the newest nvm-installed Node
 * of that major, and otherwise the newest installed Node of at least 22.6, and put it first on
 * an Exec task's PATH. They never change the nvm default alias, and fall back to whatever
 * `node` is on PATH when nvm has nothing suitable.
 */

private val NODE_VERSION = Regex("""v(\d+)\.(\d+)\.(\d+)""")

/** The oldest Node the report build runs on, as in `engines` in report/package.json. */
private val MINIMUM = Triple(22, 6, 0)

private fun File.version(): Triple<Int, Int, Int>? =
    NODE_VERSION.matchEntire(name)?.groupValues?.let { (_, a, b, c) -> Triple(a.toInt(), b.toInt(), c.toInt()) }

private fun Triple<Int, Int, Int>.atLeast(other: Triple<Int, Int, Int>): Boolean =
    compareValuesBy(this, other, { it.first }, { it.second }, { it.third }) >= 0

/**
 * `bin` of the newest complete `~/.nvm/versions/node/vN.x.y` for [preferredMajor], else of the
 * newest one at or above 22.6, else null.
 */
fun nodeBinDir(
    preferredMajor: Int?,
    home: File = File(System.getProperty("user.home")),
): File? {
    val installed =
        File(home, ".nvm/versions/node")
            .listFiles()
            ?.mapNotNull { dir -> dir.version()?.let { dir to it } }
            ?.filter { (dir, _) -> File(dir, "bin/npm").canExecute() && File(dir, "bin/node").canExecute() }
            ?.filter { (_, version) -> version.atLeast(MINIMUM) }
            .orEmpty()
    val newestFirst = installed.sortedWith(
        compareByDescending<Pair<File, Triple<Int, Int, Int>>> {
            it.second.first
        }.thenByDescending { it.second.second }.thenByDescending { it.second.third },
    )
    val pick = newestFirst.firstOrNull { it.second.first == preferredMajor } ?: newestFirst.firstOrNull()
    return pick?.first?.resolve("bin")
}

/** The major in `.nvmrc` (`24`, `v24`, `24.1.0`), or null when the file is missing or unreadable. */
fun nvmrcMajor(nvmrc: File): Int? =
    nvmrc
        .takeIf { it.isFile }
        ?.readText()
        ?.trim()
        ?.removePrefix("v")
        ?.substringBefore('.')
        ?.toIntOrNull()

/** The Node major CI uses: the `.nvmrc` at the root of this build. Read while Gradle configures. */
private fun Exec.ciNodeMajor(): Int? = nvmrcMajor(project.rootProject.file(".nvmrc"))

/**
 * Prepend the chosen Node's bin dir to this task's PATH, when there is one. The nvm lookup runs
 * when the task runs, not while Gradle configures the build, so the configuration cache does not
 * depend on what is installed under ~/.nvm or on the client's PATH.
 */
fun Exec.withNodeOnPath() {
    val major = ciNodeMajor()
    doFirst("put Node on PATH") {
        val nodeBin = nodeBinDir(major) ?: return@doFirst
        val exec = this as Exec
        val base = exec.environment["PATH"]?.toString() ?: System.getenv("PATH").orEmpty()
        exec.environment("PATH", nodeBin.absolutePath + File.pathSeparator + base)
    }
}

/**
 * Run `node` with these arguments, using the Node [nodeBinDir] picks when the task runs (else
 * `node` from PATH). Also puts that Node first on PATH, for anything the script starts.
 */
fun Exec.nodeCommandLine(vararg args: Any) {
    val major = ciNodeMajor()
    commandLine("node", *args)
    withNodeOnPath()
    doFirst("use the chosen Node") {
        (this as Exec).executable = nodeBinDir(major)?.resolve("node")?.takeIf { it.canExecute() }?.absolutePath ?: "node"
    }
}
