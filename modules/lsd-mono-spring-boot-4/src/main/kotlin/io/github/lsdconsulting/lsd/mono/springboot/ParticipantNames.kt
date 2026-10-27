package io.github.lsdconsulting.lsd.mono.springboot

import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.core.env.EnumerablePropertySource
import org.springframework.core.env.Environment
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * Names the boxes on the diagram with no configuration:
 *
 * - the app under test is `spring.application.name` (`orders-service` → `Orders service`);
 * - whoever calls it from the test is `Client`;
 * - a service it calls is named after the property that holds its URL: a call to
 *   `http://localhost:58231/charges`, where `shop.payments.base-url=http://localhost:58231`, is to
 *   `Payments`. Otherwise it is the host (and port, for loopback).
 *
 * `lsd.mono.spring.app-name` and `lsd.mono.spring.client-name` override the first two.
 */
internal class ParticipantNames(
    private val env: Environment,
) {
    val app: String =
        env.getProperty("lsd.mono.spring.app-name")
            ?: env.getProperty("spring.application.name")?.let(::humanise)?.takeIf { it.isNotBlank() }
            ?: "App"

    val client: String = env.getProperty("lsd.mono.spring.client-name") ?: DEFAULT_CLIENT

    private val names = ConcurrentHashMap<String, String>()

    /** True for a call back into this app's own server: its inbound filter draws that one. */
    fun isSelf(uri: URI): Boolean {
        val own = env.getProperty("local.server.port", Int::class.java) ?: return false
        return isLoopback(uri.host) && port(uri) == own
    }

    /** The participant a call to [uri] goes to. */
    fun of(uri: URI): String {
        val host = uri.host ?: return uri.toString()
        val key = "$host:${port(uri)}"
        return names.computeIfAbsent(key) { fromProperties(uri) ?: if (isLoopback(host)) key else host }
    }

    private fun fromProperties(target: URI): String? {
        val sources = (env as? ConfigurableEnvironment)?.propertySources ?: return null
        for (source in sources) {
            if (source !is EnumerablePropertySource<*>) continue
            for (name in source.propertyNames) {
                val value = runCatching { env.getProperty(name) }.getOrNull() ?: continue
                if (schemes.none { value.startsWith(it) }) continue
                val uri = runCatching { URI(value.trim()) }.getOrNull() ?: continue
                if (uri.host.equals(target.host, ignoreCase = true) && port(uri) == port(target)) {
                    nameFromKey(name)?.let { return it }
                }
            }
        }
        return null
    }

    companion object {
        const val DEFAULT_CLIENT: String = "Client"

        private val schemes = listOf("http://", "https://", "ws://", "wss://")

        private val generic =
            setOf(
                "url",
                "uri",
                "baseurl",
                "baseuri",
                "rooturl",
                "rooturi",
                "endpoint",
                "host",
                "address",
                "location",
                "server",
                "api",
                "http",
                "client",
                "service",
                "services",
            )

        /** `shop.payments.base-url` → `Payments`, `clients.card-network.url` → `Card network`. */
        fun nameFromKey(key: String): String? =
            key
                .split('.', '[', ']')
                .filter { it.isNotBlank() }
                .lastOrNull { it.replace("-", "").replace("_", "").lowercase() !in generic }
                ?.let(::humanise)
                ?.takeIf { it.isNotBlank() }

        /** `orders-service`, `orders_service` or `ordersService` → `Orders service`. */
        fun humanise(name: String): String {
            val words =
                name
                    .replace(Regex("([a-z0-9])([A-Z])"), "$1 $2")
                    .split('-', '_', ' ')
                    .filter { it.isNotBlank() }
                    .map { it.lowercase() }
            return words.joinToString(" ").replaceFirstChar { it.titlecase() }
        }

        internal fun port(uri: URI): Int =
            when {
                uri.port != -1 -> uri.port
                uri.scheme == "https" || uri.scheme == "wss" -> 443
                else -> 80
            }

        internal fun isLoopback(host: String?): Boolean =
            host != null && (host == "localhost" || host == "::1" || host == "[::1]" || host.startsWith("127."))
    }
}
