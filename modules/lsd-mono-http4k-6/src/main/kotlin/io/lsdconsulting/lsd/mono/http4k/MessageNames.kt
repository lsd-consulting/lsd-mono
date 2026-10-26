package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.http4k.Calls.guarded
import org.http4k.core.MemoryBody
import org.http4k.websocket.WsMessage

/**
 * The class each WebSocket message was written from, when [LsdHttp4k.labelled]'s lens wrote it,
 * so the arrow is labelled `PriceChanged` rather than `text message`. Looked up by the message's
 * content, so it holds in this JVM at either end of the socket, in memory or over a real one.
 * Holds the last [MAX_ENTRIES] messages up to [MAX_BYTES] each.
 */
internal object MessageNames {
    const val MAX_ENTRIES: Int = 512
    const val MAX_BYTES: Int = 64 * 1024

    private val names =
        object : LinkedHashMap<String, String>(MAX_ENTRIES, 0.75f, true) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?): Boolean = size > MAX_ENTRIES
        }

    /** Remembers [value]'s class for [message]: a class of the app's own, not a JDK or Kotlin one. */
    fun record(
        message: WsMessage,
        value: Any?,
    ) = guarded(Unit) {
        val name = value?.let { nameOf(it.javaClass) } ?: return@guarded
        val key = keyOf(message) ?: return@guarded
        synchronized(names) { names[key] = name }
    }

    fun of(message: WsMessage): String? = guarded(null) { keyOf(message)?.let { synchronized(names) { names[it] } } }

    /** `PriceChanged`; none for an anonymous class or a String, List or Map. */
    fun nameOf(type: Class<*>): String? {
        val pkg = type.packageName
        if (pkg == "java" || pkg.startsWith("java.") || pkg == "kotlin" || pkg.startsWith("kotlin.")) return null
        return type.simpleName.takeIf { it.isNotEmpty() }
    }

    private fun keyOf(message: WsMessage): String? {
        val body = message.body as? MemoryBody ?: return null
        val view = body.payload.duplicate()
        if (view.remaining() > MAX_BYTES) return null
        val bytes = ByteArray(view.remaining()).also { view.get(it) }
        return message.mode.name + ":" + String(bytes, Charsets.ISO_8859_1)
    }
}
