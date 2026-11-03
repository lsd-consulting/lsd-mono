package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.GradleException
import java.io.File
import java.time.Duration
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** How a short-lived command is turned into a process command line. */
internal object Commands {
    val WINDOWS: Boolean = System.getProperty("os.name").lowercase().contains("windows")

    /**
     * On Windows, npm and often node are .cmd scripts, which only cmd runs, so anything not
     * ending in .exe goes through `cmd /c`. Elsewhere the command runs as it is.
     */
    fun resolve(
        command: String,
        windows: Boolean = WINDOWS,
    ): List<String> = if (windows && !command.lowercase().endsWith(".exe")) listOf("cmd", "/c", command) else listOf(command)
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

    /**
     * Runs [command] in [directory] and returns its exit code and output. Output is read on a
     * separate thread, so a chatty command cannot block on a full pipe. A command still running
     * after [timeout] is stopped, with anything it started, and the run fails.
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
        if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            StudioProcesses.stop(process)
            reader.join(TimeUnit.SECONDS.toMillis(5))
            throw GradleException("'${command.joinToString(" ")}' did not finish within $timeout and was stopped.")
        }
        reader.join(TimeUnit.SECONDS.toMillis(5))
        return ProcessResult(process.exitValue(), synchronized(output) { output.toString() })
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
