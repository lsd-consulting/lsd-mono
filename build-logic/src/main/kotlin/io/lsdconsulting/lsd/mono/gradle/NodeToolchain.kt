package io.lsdconsulting.lsd.mono.gradle

import org.gradle.api.tasks.Exec
import java.io.File

/*
 * The report build (Vite, Vitest, Playwright, `--experimental-strip-types`) needs Node 22.6 or
 * later. Gradle may be started from a shell whose nvm default is older, so these helpers find
 * the newest nvm-installed Node 22 and put it first on an Exec task's PATH. They never change
 * the nvm default alias, and fall back to whatever `node` is on PATH when nvm has no Node 22.
 */

private val NODE_22 = Regex("""v22\.(\d+)\.(\d+)""")

/** `bin` of the newest `~/.nvm/versions/node/v22.x.y` that has both node and npm, or null. */
fun node22BinDir(home: File = File(System.getProperty("user.home"))): File? =
    File(home, ".nvm/versions/node")
        .listFiles()
        ?.filter { dir ->
            NODE_22.matches(dir.name) &&
                File(dir, "bin/npm").canExecute() &&
                File(dir, "bin/node").canExecute()
        }?.maxWithOrNull(
            compareBy(
                { NODE_22.matchEntire(it.name)!!.groupValues[1].toInt() },
                { NODE_22.matchEntire(it.name)!!.groupValues[2].toInt() },
            ),
        )?.resolve("bin")

/** Absolute path of that Node 22 `node`, else plain `node` from PATH. */
fun nodeExecutable(): String =
    node22BinDir()?.resolve("node")?.takeIf { it.canExecute() }?.absolutePath ?: "node"

/**
 * Prepend the Node 22 bin dir to this task's PATH, when there is one. The lookup runs when the
 * task runs, not while Gradle configures the build, so the configuration cache does not depend
 * on what is installed under ~/.nvm or on the client's PATH.
 */
fun Exec.withNodeOnPath() {
    doFirst("put Node 22 on PATH") {
        val nodeBin = node22BinDir() ?: return@doFirst
        val exec = this as Exec
        val base = exec.environment["PATH"]?.toString() ?: System.getenv("PATH").orEmpty()
        exec.environment("PATH", nodeBin.absolutePath + File.pathSeparator + base)
    }
}

/**
 * Run `node` with these arguments, using the Node 22 [nodeExecutable] picks when the task runs.
 * Also puts that Node first on PATH, for anything the script starts.
 */
fun Exec.nodeCommandLine(vararg args: Any) {
    commandLine("node", *args)
    withNodeOnPath()
    doFirst("use Node 22") { (this as Exec).executable = nodeExecutable() }
}
