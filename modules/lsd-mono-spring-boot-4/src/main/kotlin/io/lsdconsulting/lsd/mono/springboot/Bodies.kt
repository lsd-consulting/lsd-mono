package io.lsdconsulting.lsd.mono.springboot

import org.springframework.util.ClassUtils
import tools.jackson.databind.json.JsonMapper

/** A body as the inspector should show it: JSON as a tree when Jackson is there, else text. */
internal object Bodies {
    /** Bodies larger than this are not buffered or captured. */
    const val LIMIT: Int = 256 * 1024

    private val jackson = ClassUtils.isPresent("tools.jackson.databind.json.JsonMapper", Bodies::class.java.classLoader)

    fun read(
        bytes: ByteArray,
        contentType: String?,
    ): Any? {
        if (bytes.isEmpty()) return null
        if (jackson && contentType?.contains("json", ignoreCase = true) == true) {
            runCatching { return Json.parse(bytes) }
        }
        return bytes
    }

    private object Json {
        private val mapper = JsonMapper.builder().build()

        fun parse(bytes: ByteArray): Any? = mapper.readValue(bytes, Any::class.java)
    }
}

/** `201 Created`, `402 Payment Required`. */
internal fun statusLabel(code: Int): String {
    val reason = org.springframework.http.HttpStatus
        .resolve(code)
        ?.reasonPhrase
    return if (reason == null) code.toString() else "$code $reason"
}
