package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import org.gradle.api.logging.Logging
import java.io.File
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** How a short-lived command and its arguments are turned into a process command line. */
internal object Commands {
    val WINDOWS: Boolean = System.getProperty("os.name").lowercase().contains("windows")

    /** [text] with carriage returns and line feeds written as `\r` and `\n`, so a message stays on one line. */
    private fun visible(text: String): String = text.replace("\r", "\\r").replace("\n", "\\n")

    /** Characters cmd would act on rather than pass on, even where Java does not quote the argument. */
    private const val CMD_SPECIAL = "\"%&|<>^\r\n"

    /**
     * Whether Java builds Windows command lines in its default (legacy) way, which passes a lone
     * `"` through as it is. With `-Djdk.lang.Process.allowAmbiguousCommands=false`, or a
     * SecurityManager on JDK 17, Java quotes and escapes it instead, which [resolve] allows for.
     */
    @Suppress("DEPRECATION", "removal")
    val LEGACY_QUOTING: Boolean =
        System.getProperty("jdk.lang.Process.allowAmbiguousCommands")?.let { !it.equals("false", ignoreCase = true) }
            ?: (System.getSecurityManager() == null)

    /**
     * On Windows, npm is a .cmd script, which only cmd runs, so anything not ending in .exe goes
     * through `cmd /d /v:off /s /c " command args "`: `/d` skips AutoRun, `/v:off` turns off
     * delayed expansion (`!`) even where the registry turns it on, and `/s` makes cmd drop just
     * the outer pair of quotes. Without that outer pair, cmd strips the first and last quote of
     * the line whenever the command is quoted, which breaks a command path with a space followed
     * by any argument with a space. The outer pair relies on Java's default [legacy] quoting,
     * which passes a lone `"` through; under strict quoting it falls back to
     * `cmd /d /v:off /c command args`, where a spaced command path with a spaced argument still
     * fails. Java quotes each part that has a space; nothing else is escaped, so a part holding
     * one of `" % & | < > ^`, a carriage return or a line feed is refused (see [requireCmdSafe]).
     * Elsewhere, and for an .exe, the command and its arguments run as they are.
     */
    fun resolve(
        command: String,
        args: List<String> = emptyList(),
        windows: Boolean = WINDOWS,
        legacy: Boolean = LEGACY_QUOTING,
    ): List<String> {
        if (!windows || command.lowercase().endsWith(".exe")) return listOf(command) + args
        (listOf(command) + args).forEach { requireCmdSafe(it, "this command", windows) }
        if (!legacy) return listOf("cmd", "/d", "/v:off", "/c", command) + args
        return listOf("cmd", "/d", "/v:off", "/s", "/c", "\"", command) + args + "\""
    }

    /**
     * Checks what an npm install passes through cmd, before anything is locked, so a bad value
     * fails at once and names its setting. The package and the install folder are checked even
     * for an npm .exe, since shims such as Scoop's hand their arguments on to npm.cmd.
     */
    fun requireInstallSafe(
        npmCommand: String,
        packageArg: String,
        installDir: String,
        windows: Boolean = WINDOWS,
    ) {
        if (!npmCommand.lowercase().endsWith(".exe")) requireCmdSafe(npmCommand, "npmCommand", windows)
        requireCmdSafe(packageArg, "the lsd-mono-studio package", windows)
        requireCmdSafe(installDir, "the install folder under cacheDir", windows)
    }

    /**
     * Fails, naming [setting], when [value] cannot be passed through cmd on Windows. Called for
     * each setting before anything is locked or installed, so the message says what to change.
     */
    fun requireCmdSafe(
        value: String,
        setting: String,
        windows: Boolean = WINDOWS,
    ) {
        if (!windows) return
        val bad = value.filter { it in CMD_SPECIAL }.toSet()
        if (bad.isEmpty()) return
        val shown = bad.joinToString(" ") { visible(it.toString()) }
        throw GradleException(
            "LSD Studio cannot pass '${visible(value)}' ($setting) to npm through cmd on Windows: it contains $shown. " +
                "Use a value without them, for example an exact lsd-mono-studio version, " +
                "or lsdStudio { cacheDir = file(\"C:/lsd-studio\") } for a cache path.",
        )
    }
}

/** The result of a finished command: its exit code and its combined output. */
internal data class ProcessResult(
    val exitCode: Int,
    val output: String,
)

/**
 * Runs short-lived commands, such as `node --version` and `npm install`, with a time limit. Build
 * the command with [Commands.resolve], which on Windows routes .cmd scripts through cmd and
 * refuses arguments cmd would misread.
 */
internal object ProcessRunner {
    val NODE_VERSION_TIMEOUT: Duration = Duration.ofSeconds(30)
    val NPM_INSTALL_TIMEOUT: Duration = Duration.ofMinutes(10)
    val BROWSER_TIMEOUT: Duration = Duration.ofSeconds(10)

    /** How much of the end of the output a timeout error shows. */
    const val OUTPUT_TAIL: Int = 2048

    private val READER_WAIT: Duration = Duration.ofSeconds(5)
    private val logger = Logging.getLogger(ProcessRunner::class.java)

    /**
     * Runs [command] in [directory] and returns its exit code and output. Output is read on a
     * separate thread, so a chatty command cannot block on a full pipe. A command still running
     * after [timeout], or when this thread is interrupted, is stopped with anything it started.
     */
    fun run(
        command: List<String>,
        directory: File? = null,
        timeout: Duration,
        environment: Map<String, String> = emptyMap(),
    ): ProcessResult {
        val process =
            ProcessBuilder(command)
                .apply { directory?.let { directory(it) } }
                .apply { environment().putAll(environment) }
                .redirectErrorStream(true)
                .start()
        val output = StringBuilder()
        val reader =
            thread(isDaemon = true, name = "lsd-studio-output") {
                process.inputStream.bufferedReader().use { input ->
                    val buffer = CharArray(8192)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        synchronized(output) { output.append(buffer, 0, read) }
                    }
                }
            }
        try {
            val finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)
            if (!finished) {
                // Stop before waiting for the reader: the open pipe would otherwise hold it.
                StudioProcesses.stop(process)
                awaitReader(reader, command)
                val tail = synchronized(output) { output.takeLast(OUTPUT_TAIL).toString() }
                throw GradleException(
                    "'${command.joinToString(" ")}' did not finish within $timeout and was stopped. " +
                        "The end of its output:\n$tail",
                )
            }
        } catch (e: InterruptedException) {
            // Stop first: stop() waits, and would fail at once with the interrupt flag set again.
            StudioProcesses.stop(process)
            Thread.currentThread().interrupt()
            throw e
        }
        awaitReader(reader, command)
        return ProcessResult(process.exitValue(), synchronized(output) { output.toString() })
    }

    /** A grandchild still holding the output open can keep the reader going; say so rather than wait. */
    private fun awaitReader(
        reader: Thread,
        command: List<String>,
    ) {
        reader.join(READER_WAIT.toMillis())
        if (reader.isAlive) {
            logger.warn("LSD Studio: output of '{}' was still open after it exited; it may be cut short.", command.joinToString(" "))
        }
    }

    /** Like [run], but fails unless the command exits with 0. */
    fun runChecked(
        command: List<String>,
        directory: File? = null,
        timeout: Duration,
        environment: Map<String, String> = emptyMap(),
    ): String {
        val result = run(command, directory, timeout, environment)
        if (result.exitCode != 0) {
            throw GradleException("'${command.joinToString(" ")}' failed (exit ${result.exitCode}):\n${result.output}")
        }
        return result.output
    }
}
