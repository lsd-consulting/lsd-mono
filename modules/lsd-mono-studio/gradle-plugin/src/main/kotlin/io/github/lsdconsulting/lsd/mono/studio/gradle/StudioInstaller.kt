package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import java.io.File
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption.CREATE
import java.nio.file.StandardOpenOption.WRITE
import java.time.Duration
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.path.ExperimentalPathApi
import kotlin.io.path.deleteRecursively

/**
 * Installs lsd-mono-studio into a cache folder so that a run never sees a half-finished install:
 * npm installs into a temporary sibling folder, which is checked and then moved into place in one
 * step. A lock file next to the folder (plus a lock per folder inside this JVM, since file locks
 * belong to the whole process) makes concurrent builds wait for one install. A cached install
 * that is incomplete, from a crash or a deleted file, is renamed aside and installed again, so a
 * Studio still running from it keeps its files on Linux and macOS, and Windows fails clearly.
 */
@OptIn(ExperimentalPathApi::class)
internal object StudioInstaller {
    private val locks = ConcurrentHashMap<String, Any>()

    /** Moves [from] to [to] in one step; the tests replace it to make moves fail. */
    internal fun interface Mover {
        fun move(
            from: Path,
            to: Path,
        )
    }

    private val atomicMove = Mover { from, to -> Files.move(from, to, StandardCopyOption.ATOMIC_MOVE) }

    /**
     * Makes sure [installDir] holds a complete install of [spec], running [npm] (which installs
     * into the folder it is given) only when it does not. Returns true when it installed.
     */
    fun ensureInstalled(
        installDir: File,
        spec: String,
        lockTimeout: Duration = Duration.ofMinutes(15),
        mover: Mover = atomicMove,
        npm: (File) -> Unit,
    ): Boolean {
        val parent = installDir.absoluteFile.parentFile.apply { mkdirs() }
        val lockFile = parent.resolve("${installDir.name}.lock")
        synchronized(locks.computeIfAbsent(lockFile.canonicalPath) { Any() }) {
            FileChannel.open(lockFile.toPath(), CREATE, WRITE).use { channel ->
                lock(channel, lockFile, lockTimeout).use {
                    removeLeftovers(parent, installDir.name)
                    if (isComplete(installDir, spec)) return false
                    if (installDir.exists()) moveAside(installDir, mover)
                    val tmp = Files.createTempDirectory(parent.toPath(), "${installDir.name}.tmp-")
                    try {
                        npm(tmp.toFile())
                        missing(tmp.toFile())?.let {
                            throw GradleException(
                                "npm installed $spec, but the install is incomplete ($it is missing). " +
                                    "It was removed; run the task again, or check the package.",
                            )
                        }
                        StudioPackage.installedMarker(tmp.toFile()).writeText("$spec\n")
                        move(tmp, installDir.toPath(), mover)
                    } finally {
                        deleteQuietly(tmp)
                    }
                    return true
                }
            }
        }
    }

    /**
     * True when [installDir] has the marker of a finished install of [spec] (any spec when null)
     * and the files a run needs.
     */
    fun isComplete(
        installDir: File,
        spec: String? = null,
    ): Boolean {
        val marker = StudioPackage.installedMarker(installDir)
        return marker.isFile && (spec == null || marker.readText().trim() == spec) && missing(installDir) == null
    }

    /**
     * Takes the lock on [channel]. Another class loader in this JVM (an included build, or a
     * different buildscript classpath) has its own [locks], and the JVM then reports the overlap
     * instead of waiting, so poll until it is free.
     */
    private fun lock(
        channel: FileChannel,
        lockFile: File,
        timeout: Duration,
    ): FileLock {
        val deadline = System.nanoTime() + timeout.toNanos()
        while (true) {
            try {
                return channel.lock()
            } catch (_: OverlappingFileLockException) {
                if (System.nanoTime() > deadline) {
                    throw GradleException("Waited $timeout for another lsd-mono-studio install to finish ($lockFile).")
                }
                Thread.sleep(100)
            }
        }
    }

    /** Removes temporary and moved-aside folders that a killed build left behind. Only called under the lock. */
    private fun removeLeftovers(
        parent: File,
        name: String,
    ) {
        parent
            .listFiles { file -> file.isDirectory && (file.name.startsWith("$name.tmp-") || file.name.startsWith("$name.old-")) }
            ?.forEach { deleteQuietly(it.toPath()) }
    }

    /** Renames a broken install aside in one step, then deletes it as far as it can. */
    private fun moveAside(
        installDir: File,
        mover: Mover,
    ) {
        val aside = installDir.resolveSibling("${installDir.name}.old-${UUID.randomUUID()}").toPath()
        try {
            mover.move(installDir.toPath(), aside)
        } catch (e: IOException) {
            throw GradleException(
                "The lsd-mono-studio install at $installDir is incomplete and in use, so it cannot be replaced. " +
                    "Stop any LSD Studio running from it and run the task again.",
                e,
            )
        }
        deleteQuietly(aside)
    }

    /** The first file a run needs that [installDir] lacks: package.json, the entry script or the built dist/main.js. */
    private fun missing(installDir: File): File? {
        val packageDir = StudioPackage.packageDir(installDir)
        val script =
            try {
                StudioPackage.binScript(packageDir)
            } catch (_: IllegalStateException) {
                return packageDir.resolve("package.json")
            }
        if (!script.isFile) return script
        return StudioPackage.builtMain(script).takeUnless { it.isFile }
    }

    /** Moves the checked install into place. Windows can briefly hold new files open (virus scanners), so retry. */
    private fun move(
        from: Path,
        to: Path,
        mover: Mover,
    ) {
        var attempt = 1
        while (true) {
            try {
                mover.move(from, to)
                return
            } catch (e: AtomicMoveNotSupportedException) {
                throw GradleException("The file system of $to cannot move the lsd-mono-studio install into place in one step: $e", e)
            } catch (e: IOException) {
                if (attempt == MOVE_ATTEMPTS) throw GradleException("Could not move the lsd-mono-studio install into $to: $e", e)
                attempt++
                Thread.sleep(500)
            }
        }
    }

    /** Best effort: a file still held open (Windows) stays until the next install removes leftovers. */
    private fun deleteQuietly(path: Path) {
        try {
            path.deleteRecursively()
        } catch (_: IOException) {
        }
    }

    const val MOVE_ATTEMPTS: Int = 3
}
