package io.lsdconsulting.lsd.mono.http4k

import io.lsdconsulting.lsd.mono.http4k.Calls.guarded
import org.http4k.core.MemoryBody
import org.http4k.websocket.WsMessage
import java.security.MessageDigest

/**
 * The class each WebSocket message was written from, when [LsdHttp4k.labelled]'s lens wrote it,
 * so the arrow is labelled `PriceChanged` rather than `text message`. Looked up by the message's
 * mode, length and SHA-256, so it holds in this JVM at either end of the socket, in memory or over
 * a real one. Bytes written from two different classes name neither. Holds the last
 * [MAX_ENTRIES] messages up to [MAX_BYTES] each.
 */
internal object MessageNames {
    const val MAX_ENTRIES: Int = 512
    const val MAX_BYTES: Int = 64 * 1024

    /** Stands for bytes more than one class was written as: the default label, not a guess. */
    private const val AMBIGUOUS = ""

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
        synchronized(names) { names[key] = names[key].let { if (it == null || it == name) name else AMBIGUOUS } }
    }

    fun of(message: WsMessage): String? =
        guarded(null) { keyOf(message)?.let { synchronized(names) { names[it] } }?.takeIf { it != AMBIGUOUS } }

    /** `PriceChanged`; none for an anonymous class or a String, List or Map. */
    fun nameOf(type: Class<*>): String? {
        val pkg = type.packageName
        if (pkg == "java" || pkg.startsWith("java.") || pkg == "kotlin" || pkg.startsWith("kotlin.")) return null
        return type.simpleName.takeIf { it.isNotEmpty() }
    }

    /** `Text:17:<sha-256>`: about 100 bytes held per message, whatever its size. */
    private fun keyOf(message: WsMessage): String? {
        val body = message.body as? MemoryBody ?: return null
        val view = body.payload.duplicate()
        val length = view.remaining()
        if (length > MAX_BYTES) return null
        val digest = MessageDigest.getInstance("SHA-256").apply { update(view) }.digest()
        return message.mode.name + ":" + length + ":" + digest.joinToString("") { "%02x".format(it) }
    }
}
