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

    /** Whether to open a browser: only when asked to, and never on CI. */
    fun shouldBrowse(
        openBrowser: Boolean,
        ci: Boolean,
    ): Boolean = openBrowser && !ci

    /**
     * Opens [url] through [launch] when [shouldBrowse] allows it, with the launcher for [os].
     * Returns whether a launch was requested.
     */
    fun browse(
        url: String,
        openBrowser: Boolean,
        ci: Boolean,
        os: String,
        launch: (List<String>) -> Unit,
    ): Boolean {
        if (!shouldBrowse(openBrowser, ci)) return false
        launch(command(os, url))
        return true
    }

    /**
     * Runs [command] on a daemon thread and returns that thread. A launcher that fails to start
     * goes to [onFailure]; one still running after [timeout] is destroyed (forcibly if it ignores that
     * for a second), its children left alone.
     */
    fun launch(
        command: List<String>,
        timeout: Duration = ProcessRunner.BROWSER_TIMEOUT,
        onFailure: (Exception) -> Unit = {},
    ): Thread =
        Thread({
            try {
                // DISCARD and the stdin close matter for real browsers: one forked by the launcher
                // inherits its pipes and could otherwise hold them open for as long as it runs.
                val process =
                    ProcessBuilder(command)
                        .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                        .redirectError(ProcessBuilder.Redirect.DISCARD)
                        .start()
                process.outputStream.close()
                if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    // The launcher only: its descendants may be the browser it just opened.
                    process.destroy()
                    if (!process.waitFor(1, TimeUnit.SECONDS)) process.destroyForcibly()
                }
            } catch (e: Exception) {
                onFailure(e)
            }
        }, "lsd-studio-browser").apply {
            isDaemon = true
            start()
        }
}
