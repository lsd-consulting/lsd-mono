package io.github.lsdconsulting.lsd.mono.ktor

import io.github.lsdconsulting.lsd.mono.ktor.Calls.guarded
import io.ktor.websocket.Frame
import java.security.MessageDigest

/**
 * The class each WebSocket message was written from, when a converter wrapped by
 * [LsdKtor.labelled] wrote it, so the arrow is labelled `PriceChanged` rather than
 * `text message`. Looked up by the frame's type, length and SHA-256, so it holds in this JVM at
 * either end of the socket, in memory or over a real one. Bytes written from two different
 * classes name neither. Holds the [MAX_ENTRIES] messages most recently written or looked up,
 * up to [MAX_BYTES] each.
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

    /** Remembers [value]'s class for [frame]: a class of the app's own, not a JDK or Kotlin one. */
    fun record(
        frame: Frame,
        value: Any?,
    ) = guarded(Unit) {
        val name = value?.let { nameOf(it.javaClass) } ?: return@guarded
        val key = keyOf(frame) ?: return@guarded
        synchronized(names) { names[key] = names[key].let { if (it == null || it == name) name else AMBIGUOUS } }
    }

    fun of(frame: Frame): String? = guarded(null) { keyOf(frame)?.let { synchronized(names) { names[it] } }?.takeIf { it != AMBIGUOUS } }

    /** `PriceChanged`; none for an anonymous class or a String, List or Map. */
    fun nameOf(type: Class<*>): String? {
        val pkg = type.packageName
        if (pkg == "java" || pkg.startsWith("java.") || pkg == "kotlin" || pkg.startsWith("kotlin.")) return null
        return type.simpleName.takeIf { it.isNotEmpty() }
    }

    /** `TEXT:17:<sha-256>`: about 100 bytes held per message, whatever its size. */
    private fun keyOf(frame: Frame): String? {
        val data = frame.data
        if (data.size > MAX_BYTES) return null
        val digest = MessageDigest.getInstance("SHA-256").digest(data)
        return frame.frameType.name + ":" + data.size + ":" + digest.joinToString("") { "%02x".format(it) }
    }
}
