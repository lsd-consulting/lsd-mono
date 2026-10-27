package io.github.lsdconsulting.lsd.mono.springboot

import java.time.temporal.TemporalAccessor
import java.util.Optional
import java.util.UUID

/**
 * One-line summaries of what went into and came out of a repository call: `"lamp-01"`, `Order(id=7)`,
 * `List(3)`, `Optional.empty`. Deliberately shallow: an entity is never walked, so a lazy JPA
 * association is never loaded just to draw it.
 */
internal object Summaries {
    const val MAX: Int = 120

    fun of(value: Any?): String =
        when (value) {
            null -> "null"
            Unit -> "void"
            is CharSequence -> "\"${truncate(value.toString(), MAX - 2)}\""
            is Number, is Boolean, is Char, is Enum<*>, is UUID, is TemporalAccessor -> truncate(value.toString())
            is Optional<*> -> if (value.isPresent) "Optional[${of(value.get())}]" else "Optional.empty"
            is Set<*> -> "Set(${value.size})"
            is Collection<*> -> "List(${value.size})"
            is Map<*, *> -> "Map(${value.size})"
            is Array<*> -> "Array(${value.size})"
            is ByteArray -> "bytes(${value.size})"
            is Iterator<*>, is java.util.stream.BaseStream<*, *> -> value.javaClass.simpleName.ifEmpty { "Stream" }
            is Iterable<*> -> iterable(value)
            else -> entity(value)
        }

    /** A Spring Data `Page` or `Slice` says how much it holds; any other iterable just its type. */
    private fun iterable(value: Iterable<*>): String {
        val size = runCatching { value.javaClass.getMethod("getNumberOfElements").invoke(value) as? Int }.getOrNull()
        val type = value.javaClass.simpleName
            .removeSuffix("Impl")
            .ifEmpty { "Iterable" }
        return if (size == null) type else "$type($size)"
    }

    /** Its own `toString` when it has one (records, data classes), else just the type. */
    private fun entity(value: Any): String {
        val type = value.javaClass.simpleName.ifEmpty { value.javaClass.name }
        val own = runCatching { value.javaClass.getMethod("toString").declaringClass != Any::class.java }.getOrDefault(false)
        if (!own) return type
        return runCatching { truncate(value.toString()) }.getOrDefault(type)
    }

    fun truncate(
        text: String,
        max: Int = MAX,
    ): String = if (text.length <= max) text else text.take(max - 1) + "…"
}
