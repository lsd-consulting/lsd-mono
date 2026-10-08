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
        }
        ?.maxWithOrNull(
            compareBy(
                { NODE_22.matchEntire(it.name)!!.groupValues[1].toInt() },
                { NODE_22.matchEntire(it.name)!!.groupValues[2].toInt() },
            ),
        )
        ?.resolve("bin")

/** Absolute path of that Node 22 `node`, else plain `node` from PATH. */
fun nodeExecutable(): String =
    node22BinDir()?.resolve("node")?.takeIf { it.canExecute() }?.absolutePath ?: "node"

/** Prepend the Node 22 bin dir to this task's PATH, when there is one. */
fun Exec.withNodeOnPath() {
    val nodeBin = node22BinDir() ?: return
    val base = System.getenv("PATH").orEmpty()
    environment("PATH", nodeBin.absolutePath + File.pathSeparator + base)
}
