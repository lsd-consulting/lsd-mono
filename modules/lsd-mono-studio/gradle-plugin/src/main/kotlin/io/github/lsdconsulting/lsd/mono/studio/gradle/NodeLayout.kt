package io.github.lsdconsulting.lsd.mono.studio.gradle

import java.io.File

/**
 * Where node and npm are in a downloaded Node.js: Node's own archives keep node.exe and npm.cmd at
 * the top on Windows, and both under bin/ elsewhere.
 */
internal object NodeLayout {
    fun binDir(
        nodeDir: File,
        windows: Boolean,
    ): File = if (windows) nodeDir else nodeDir.resolve("bin")

    fun node(
        binDir: File,
        windows: Boolean,
    ): File = binDir.resolve(if (windows) "node.exe" else "node")

    fun npm(
        binDir: File,
        windows: Boolean,
    ): File = binDir.resolve(if (windows) "npm.cmd" else "npm")
}
