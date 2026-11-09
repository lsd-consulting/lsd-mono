package io.github.lsdconsulting.lsd.mono.studio.gradle

/**
 * How the lsdStudio task starts Studio: the listen address, the process command, and the URL
 * printed once Studio is up.
 */
internal object StudioLaunch {
    private val STARTED = Regex("""LSD Studio on (https?://\S+)""")

    /** Listen on every interface when exposing, otherwise localhost only. */
    fun host(expose: Boolean): String = if (expose) "0.0.0.0" else "127.0.0.1"

    /**
     * The process command: [node] running [script] on [port]. `--expose` is added only when
     * [host] is every interface, matching Studio's own flag.
     */
    fun command(
        node: String,
        script: String,
        port: Int,
        host: String,
    ): List<String> {
        val command = mutableListOf(node, script, "--port", port.toString())
        if (host == "0.0.0.0") command += "--expose"
        return command
    }

    /**
     * The URL Studio printed on [line], with `0.0.0.0` rewritten to `localhost` so a browser
     * can open it. Null when the line is not Studio's "started" message.
     */
    fun startedUrl(line: String): String? =
        STARTED
            .find(line)
            ?.groupValues
            ?.get(1)
            ?.replace("0.0.0.0", "localhost")
}
