package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties

/**
 * Hosts allowed to receive the scenario header (`lsd.mono.propagation.allowedHosts`).
 * Entries are compared ignoring case: a host name or address, `*.example.test` for any
 * subdomain of `example.test` (not `example.test` itself), or `*` for every host. IPv6
 * addresses may be written with or without brackets.
 */
internal class HostAllowList(
    entries: List<String>,
) {
    private val entries = entries.map(::normalise)

    fun allows(host: String): Boolean {
        val wanted = normalise(host)
        if (wanted.isEmpty()) return false
        return entries.any { entry ->
            when {
                entry == "*" -> true
                entry.startsWith("*.") -> wanted.endsWith(entry.substring(1)) && wanted.length > entry.length - 1
                else -> entry == wanted
            }
        }
    }

    companion object {
        fun fromProperties(): HostAllowList = HostAllowList(LsdProperties.propagationAllowedHosts())

        private fun normalise(host: String): String = host
            .trim()
            .lowercase()
            .removePrefix("[")
            .removeSuffix("]")
            .removeSuffix(".")
    }
}
