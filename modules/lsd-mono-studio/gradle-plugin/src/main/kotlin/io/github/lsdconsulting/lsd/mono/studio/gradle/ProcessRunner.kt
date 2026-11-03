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

    /**
     * On Windows, npm and often node are .cmd scripts, which only cmd runs, so anything not
     * ending in .exe goes through cmd, as one command line built by [cmdLine]. Elsewhere, and
     * for an .exe, the command and its arguments run as they are.
     */
    fun resolve(
        command: String,
        args: List<String> = emptyList(),
        windows: Boolean = WINDOWS,
    ): List<String> =
        if (windows && !command.lowercase().endsWith(".exe")) {
            listOf("cmd", "/d", "/s", "/c", cmdLine(listOf(command) + args))
        } else {
            listOf(command) + args
        }

    /**
     * Builds the line that `cmd /d /s /c` runs. Every token is quoted, so spaces and the
     * characters `& | < > ( ) ^` are taken literally, and the whole line is quoted once more,
     * which `/s` strips again without touching the inner quotes (`/d` skips AutoRun). cmd still
     * expands `%NAME%` inside quotes, so a `%` is written outside them, escaped as `^%`. A token
     * holding a double quote cannot be passed safely, and is refused.
     */
    fun cmdLine(tokens: List<String>): String =
        tokens.joinToString(" ", prefix = "\"", postfix = "\"") { token ->
            require('"' !in token) { "Cannot pass an argument containing a double quote through cmd: $token" }
            "\"" + token.replace("%", "\"^%\"") + "\""
        }
}

/** The result of a finished command: its exit code and its combined output. */
internal data class ProcessResult(
    val exitCode: Int,
    val output: String,
)

/** Runs short-lived commands, such as `node --version` and `npm install`, with a time limit. */
internal object ProcessRunner {
    val NODE_VERSION_TIMEOUT: Duration = Duration.ofSeconds(30)
    val NPM_INSTALL_TIMEOUT: Duration = Duration.ofMinutes(10)

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
    ): ProcessResult {
        val process =
            ProcessBuilder(command)
                .apply { directory?.let { directory(it) } }
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
        } finally {
            if (process.isAlive) StudioProcesses.stop(process)
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
    ): String {
        val result = run(command, directory, timeout)
        if (result.exitCode != 0) {
            throw GradleException("'${command.joinToString(" ")}' failed (exit ${result.exitCode}):\n${result.output}")
        }
        return result.output
    }
}
