package io.github.lsdconsulting.lsd.mono.studio.gradle

import java.io.File
import java.net.URLEncoder

/**
 * The environment npm runs with: Gradle's proxy settings (`systemProp.http(s).proxyHost` and the
 * rest, usually in gradle.properties) as `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, and a
 * downloaded Node's folder first on the `PATH`, so npm's own script finds that Node. A proxy
 * variable already set (and not blank), in any case, wins. The proxy URLs may hold credentials: never log them.
 */
internal object NpmEnvironment {
    /** The Gradle system properties read, so the plugin can pass only these to the task. */
    val PROXY_PROPERTIES: List<String> =
        listOf("http", "https").flatMap { scheme ->
            listOf("proxyHost", "proxyPort", "proxyUser", "proxyPassword").map { "$scheme.$it" }
        } + "http.nonProxyHosts"

    fun of(
        properties: Map<String, String>,
        existing: Map<String, String>,
        nodeBinDir: File? = null,
        windows: Boolean = Commands.WINDOWS,
    ): Map<String, String> {
        val env = mutableMapOf<String, String>()

        fun setUnlessPresent(
            name: String,
            value: String?,
        ) {
            if (value == null) return
            if (existing.none { (k, v) -> k.equals(name, ignoreCase = true) && v.isNotBlank() }) env[name] = value
        }
        setUnlessPresent("HTTP_PROXY", proxyUrl(properties, "http"))
        setUnlessPresent("HTTPS_PROXY", proxyUrl(properties, "https"))
        setUnlessPresent("NO_PROXY", noProxy(properties["http.nonProxyHosts"]))
        if (nodeBinDir != null) {
            // Windows keeps it as Path; keep whichever spelling is already there.
            val name = existing.keys.firstOrNull { it.equals("PATH", ignoreCase = windows) } ?: "PATH"
            val rest = existing[name]
            env[name] = if (rest.isNullOrEmpty()) nodeBinDir.path else nodeBinDir.path + File.pathSeparator + rest
        }
        return env
    }

    /** `http://user:password@host:port` from Gradle's `<scheme>.proxy*` properties, or null without a host. */
    fun proxyUrl(
        properties: Map<String, String>,
        scheme: String,
    ): String? {
        val host = properties["$scheme.proxyHost"]?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val port = properties["$scheme.proxyPort"]?.trim()?.takeIf { it.isNotEmpty() } ?: if (scheme == "https") "443" else "80"
        val user = properties["$scheme.proxyUser"]?.takeIf { it.isNotEmpty() }
        val auth =
            user?.let { u ->
                val password = properties["$scheme.proxyPassword"]
                encode(u) + (password?.let { ":" + encode(it) } ?: "") + "@"
            } ?: ""
        // The proxy itself is reached over plain http, as Java's own proxy settings mean it.
        return "http://$auth$host:$port"
    }

    /** Java's `a|*.b|localhost` as npm's `a,.b,localhost`. */
    fun noProxy(nonProxyHosts: String?): String? =
        nonProxyHosts
            ?.split('|')
            ?.map { it.trim().removePrefix("*") }
            ?.filter { it.isNotEmpty() }
            ?.takeIf { it.isNotEmpty() }
            ?.joinToString(",")

    private fun encode(text: String) = URLEncoder.encode(text, Charsets.UTF_8).replace("+", "%20")
}
