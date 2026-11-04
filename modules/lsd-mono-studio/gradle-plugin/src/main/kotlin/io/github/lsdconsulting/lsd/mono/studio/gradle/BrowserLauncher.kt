package io.github.lsdconsulting.lsd.mono.studio.gradle

import java.time.Duration
import java.util.concurrent.TimeUnit

/**
 * Opens a URL in the user's browser through the OS launcher (open, xdg-open or rundll32), off the
 * calling thread. The launcher is started directly with its output discarded, so a browser it
 * forks cannot hold a pipe open, and after [ProcessRunner.BROWSER_TIMEOUT] only the launcher
 * itself is destroyed: never its descendants, which may be the browser (xdg-open can run the
 * browser in the foreground).
 */
internal object BrowserLauncher {
    /** The launcher command for [url] on the OS named [os] (`os.name`). */
    fun command(
        os: String,
        url: String,
    ): List<String> {
        val name = os.lowercase()
        return when {
            name.contains("mac") -> listOf("open", url)
            name.contains("windows") -> listOf("rundll32", "url.dll,FileProtocolHandler", url)
            else -> listOf("xdg-open", url)
        }
    }

    /**
     * Runs [command] on a daemon thread and returns that thread. A launcher that fails to start
     * goes to [onFailure]; one still running after [timeout] is destroyed, its children left alone.
     */
    fun launch(
        command: List<String>,
        timeout: Duration = ProcessRunner.BROWSER_TIMEOUT,
        onFailure: (Exception) -> Unit = {},
    ): Thread =
        Thread({
            try {
                val process =
                    ProcessBuilder(command)
                        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                        .redirectError(ProcessBuilder.Redirect.DISCARD)
                        .start()
                process.outputStream.close()
                if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    // The launcher only: its descendants may be the browser it just opened.
                    process.destroy()
                    process.waitFor(1, TimeUnit.SECONDS)
                }
            } catch (e: Exception) {
                onFailure(e)
            }
        }, "lsd-studio-browser").apply {
            isDaemon = true
            start()
        }
}
