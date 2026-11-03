package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import java.io.File
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption.CREATE
import java.nio.file.StandardOpenOption.WRITE
import java.util.concurrent.ConcurrentHashMap

/**
 * Installs lsd-mono-studio into a cache folder so that a run never sees a half-finished install:
 * npm installs into a temporary sibling folder, which is checked and then moved into place in one
 * step. A lock file next to the folder (plus a lock per folder inside this JVM, since file locks
 * belong to the whole process) makes concurrent builds wait for one install. A cached install
 * that is incomplete, from a crash or a deleted file, is removed and installed again.
 */
internal object StudioInstaller {
    private val locks = ConcurrentHashMap<String, Any>()

    /**
     * Makes sure [installDir] holds a complete install of [spec], running [npm] (which installs
     * into the folder it is given) only when it does not. Returns true when it installed.
     */
    fun ensureInstalled(
        installDir: File,
        spec: String,
        npm: (File) -> Unit,
    ): Boolean {
        val parent = installDir.absoluteFile.parentFile.apply { mkdirs() }
        val lockFile = parent.resolve("${installDir.name}.lock")
        synchronized(locks.computeIfAbsent(lockFile.canonicalPath) { Any() }) {
            FileChannel.open(lockFile.toPath(), CREATE, WRITE).use { channel ->
                channel.lock().use {
                    if (isComplete(installDir)) return false
                    installDir.deleteRecursively()
                    val tmp = Files.createTempDirectory(parent.toPath(), "${installDir.name}.tmp-").toFile()
                    try {
                        npm(tmp)
                        missing(tmp)?.let {
                            throw GradleException(
                                "npm installed $spec, but the install is incomplete ($it is missing). " +
                                    "It was removed; run the task again, or check the package.",
                            )
                        }
                        StudioPackage.installedMarker(tmp).writeText("$spec\n")
                        move(tmp, installDir)
                    } finally {
                        tmp.deleteRecursively()
                    }
                    return true
                }
            }
        }
    }

    /** True when [installDir] has the marker of a finished install and the files a run needs. */
    fun isComplete(installDir: File): Boolean = StudioPackage.installedMarker(installDir).isFile && missing(installDir) == null

    /** The first file a run needs that [installDir] lacks: the entry script or the built dist/main.js. */
    private fun missing(installDir: File): File? {
        val packageDir = StudioPackage.packageDir(installDir)
        val script =
            try {
                StudioPackage.binScript(packageDir)
            } catch (e: IllegalStateException) {
                return packageDir.resolve("package.json")
            }
        if (!script.isFile) return script
        return StudioPackage.builtMain(script).takeUnless { it.isFile }
    }

    /** Moves the checked install into place. Windows can briefly hold new files open (virus scanners), so retry. */
    private fun move(
        from: File,
        to: File,
    ) {
        var attempt = 1
        while (true) {
            try {
                Files.move(from.toPath(), to.toPath(), StandardCopyOption.ATOMIC_MOVE)
                return
            } catch (e: IOException) {
                if (attempt == 3) throw GradleException("Could not move the lsd-mono-studio install into $to: $e", e)
                attempt++
                Thread.sleep(500)
            }
        }
    }
}
