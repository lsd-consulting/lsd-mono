package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.gradle.api.logging.Logging
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
 * that is incomplete, from a crash or a deleted file, is renamed aside and installed again. The
 * renamed folder is only deleted an hour later, by a later install, so a Studio still running from
 * it can keep reading its files meanwhile; on Windows a folder in use cannot be renamed, and the
 * install fails clearly instead.
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

    /** Deletes a folder and everything in it; the tests replace it to make deletes fail. */
    internal fun interface Deleter {
        fun delete(path: Path)
    }

    private val recursiveDelete = Deleter { it.deleteRecursively() }

    /**
     * How old a moved-aside folder must be before a later install deletes it. The age compares
     * this machine's clock with the folder's time, so a shared cache on a machine with a skewed
     * clock may delete a little early or late.
     */
    val OLD_INSTALL_AGE: Duration = Duration.ofHours(1)

    /**
     * Makes sure [installDir] holds a complete install of [spec], running [npm] (which installs
     * into the folder it is given) only when it does not. Returns true when it installed.
     */
    fun ensureInstalled(
        installDir: File,
        spec: String,
        lockTimeout: Duration = Duration.ofMinutes(15),
        mover: Mover = atomicMove,
        deleter: Deleter = recursiveDelete,
        npm: (File) -> Unit,
    ): Boolean {
        val parent = installDir.absoluteFile.parentFile.apply { mkdirs() }
        val lockFile = parent.resolve("${installDir.name}.lock")
        // The file lock alone is enough; synchronizing first only saves this JVM's threads from polling.
        synchronized(locks.computeIfAbsent(lockFile.canonicalPath) { Any() }) {
            FileChannel.open(lockFile.toPath(), CREATE, WRITE).use { channel ->
                lock(channel, lockFile, lockTimeout).use {
                    removeLeftovers(parent, installDir.name, deleter)
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
                        deleteQuietly(tmp, deleter)
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
     * Takes the lock on [channel], polling until [timeout] so that a hung build elsewhere fails
     * clearly. Another class loader in this JVM (an included build, or a different buildscript
     * classpath) has its own [locks], and the JVM reports that overlap rather than waiting.
     */
    private fun lock(
        channel: FileChannel,
        lockFile: File,
        timeout: Duration,
    ): FileLock {
        val deadline = System.nanoTime() + timeout.toNanos()
        while (true) {
            val lock =
                try {
                    channel.tryLock()
                } catch (_: OverlappingFileLockException) {
                    null
                }
            if (lock != null) return lock
            if (System.nanoTime() > deadline) {
                throw GradleException("Waited $timeout for another lsd-mono-studio install to finish ($lockFile).")
            }
            Thread.sleep(LOCK_POLL.toMillis())
        }
    }

    /**
     * Removes temporary folders that a killed build left behind, and moved-aside installs older
     * than [OLD_INSTALL_AGE]. Only called under the lock.
     */
    private fun removeLeftovers(
        parent: File,
        name: String,
        deleter: Deleter,
    ) {
        val oldBefore = System.currentTimeMillis() - OLD_INSTALL_AGE.toMillis()
        parent
            .listFiles { file ->
                file.isDirectory &&
                    (file.name.startsWith("$name.tmp-") || (file.name.startsWith("$name.old-") && file.lastModified() < oldBefore))
            }?.forEach { deleteQuietly(it.toPath(), deleter) }
    }

    /**
     * Renames an install that is incomplete, or for another spec, aside in one step. It stays until
     * a later install finds it older than [OLD_INSTALL_AGE], so the clock starts now.
     */
    private fun moveAside(
        installDir: File,
        mover: Mover,
    ) {
        val aside = installDir.resolveSibling("${installDir.name}.old-${UUID.randomUUID()}")
        try {
            mover.move(installDir.toPath(), aside.toPath())
        } catch (e: AtomicMoveNotSupportedException) {
            throw GradleException("The file system of $installDir cannot move the lsd-mono-studio install aside in one step: $e", e)
        } catch (e: IOException) {
            throw GradleException(
                "The lsd-mono-studio install at $installDir needs replacing, but cannot be moved aside " +
                    "(probably in use: $e). Stop any LSD Studio running from it and run the task again.",
                e,
            )
        }
        // A rename keeps the folder's own time, so restart the clock that removeLeftovers reads.
        if (!aside.setLastModified(System.currentTimeMillis())) {
            Logging.getLogger(StudioInstaller::class.java).warn("LSD Studio: could not set the time of {}; it may be removed early.", aside)
        }
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

    /** Best effort: a file still held open (Windows) stays until a later install removes leftovers. */
    private fun deleteQuietly(
        path: Path,
        deleter: Deleter,
    ) {
        try {
            deleter.delete(path)
        } catch (_: IOException) {
        }
    }

    const val MOVE_ATTEMPTS: Int = 3

    /** How long to wait between attempts to take a lock that someone else holds. */
    val LOCK_POLL: Duration = Duration.ofMillis(100)
}
