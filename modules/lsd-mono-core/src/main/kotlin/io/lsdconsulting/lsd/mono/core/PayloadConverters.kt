package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdKey
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.math.BigDecimal
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.time.temporal.TemporalAccessor
import java.time.temporal.TemporalAmount
import java.util.Base64
import java.util.Calendar
import java.util.Date
import java.util.IdentityHashMap
import java.util.Optional
import java.util.OptionalDouble
import java.util.OptionalInt
import java.util.OptionalLong
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.function.Function

/**
 * The converters for message data, reached as `lsd.payloads`. Register one for a type
 * that should not be copied field by field, for example a JSON tree:
 *
 * ```kotlin
 * lsd.payloads.register<JsonNode> { mapper.convertValue(it, Map::class.java) }
 * ```
 * ```java
 * lsd.getPayloads().register(JsonNode.class, node -> mapper.convertValue(node, Map.class));
 * ```
 *
 * A converter's result is copied in turn. A converter that throws gives a marker.
 * Later registrations win. Thread-safe.
 *
 * Message data is copied into an immutable, JSON-shaped value when it is captured, so
 * later changes by the test (a reused body, a builder, a pooled buffer) cannot change
 * the report.
 *
 * The result only contains `null`, [String], [Boolean], [Long], [Double], [BigInteger],
 * [BigDecimal], read-only `Map<String, Any?>` and read-only `List<Any?>`:
 * - Maps become objects. Keys that are not strings use their text; a repeated key gets ` #2`.
 * - Iterables, arrays and primitive arrays become lists.
 * - `ByteArray` and `ByteBuffer` become text when they are valid UTF-8 text, otherwise
 *   `[lsd: binary, N bytes] base64:...`. A `ByteBuffer`'s position is not moved.
 * - `Optional` becomes its value or null, enums their name, `java.time` values,
 *   `Date`, `UUID`, `URI`, paths and similar value types their ISO or plain text.
 * - Java records and Kotlin data classes (any class outside the JDK and Kotlin
 *   libraries with instance fields) become objects of their fields or components.
 * - A `Throwable` becomes `{"exception": class, "message": message}`.
 * - Anything else becomes its `toString()`.
 *
 * It never throws. Cycles, too-deep nesting, oversized strings, collections or totals,
 * and failing `toString()`s or getters become `[lsd: ...]` marker strings. The limits
 * come from the `lsd.mono.payload.*` properties (see [LsdProperties]), re-read by
 * `LsdContext.clear()`.
 */
public class PayloadConverters internal constructor(
    @Volatile internal var limits: Limits = Limits.fromProperties(),
) {
    /**
     * @property maxDepth nesting depth before `[lsd: max depth N reached]`.
     * @property maxStringLength characters kept from one string (or base64 text).
     * @property maxItems entries kept from one collection, map, array or object.
     * @property maxTotalSize rough size budget for one payload, in characters.
     */
    internal data class Limits(
        val maxDepth: Int = LsdKey.PAYLOAD_MAX_DEPTH.defaultInt(),
        val maxStringLength: Int = LsdKey.PAYLOAD_MAX_STRING_LENGTH.defaultInt(),
        val maxItems: Int = LsdKey.PAYLOAD_MAX_ITEMS.defaultInt(),
        val maxTotalSize: Int = LsdKey.PAYLOAD_MAX_TOTAL_SIZE.defaultInt(),
    ) {
        companion object {
            /** The limits set by the `lsd.mono.payload.*` properties (see [LsdProperties]). */
            fun fromProperties(): Limits =
                Limits(
                    maxDepth = LsdProperties.payloadLimit(LsdKey.PAYLOAD_MAX_DEPTH),
                    maxStringLength = LsdProperties.payloadLimit(LsdKey.PAYLOAD_MAX_STRING_LENGTH),
                    maxItems = LsdProperties.payloadLimit(LsdKey.PAYLOAD_MAX_ITEMS),
                    maxTotalSize = LsdProperties.payloadLimit(LsdKey.PAYLOAD_MAX_TOTAL_SIZE),
                )
        }
    }

    private class Converter<T : Any>(val type: Class<T>, val convert: Function<in T, out Any?>)

    private val converters = CopyOnWriteArrayList<Converter<*>>()

    /**
     * Convert values of [type] (and subtypes) with [converter] first. Later registrations
     * win. The result is snapshotted in turn, without applying a converter to it again.
     */
    public fun <T : Any> register(type: Class<T>, converter: Function<in T, out Any?>): PayloadConverters =
        apply { converters.add(0, Converter(type, converter)) }

    /** Kotlin form of [register]: `lsd.payloads.register<JsonNode> { mapper.convertValue(it, Map::class.java) }`. */
    @JvmSynthetic
    public inline fun <reified T : Any> register(noinline converter: (T) -> Any?): PayloadConverters =
        register(T::class.java, Function(converter))

    /** Remove every registered converter. */
    public fun clear(): Unit = converters.clear()

    /** An immutable, JSON-shaped copy of [value]. Never throws. */
    internal fun snapshot(value: Any?): Any? =
        try {
            Walk(limits).copy(value, 0)
        } catch (e: StackOverflowError) {
            marker("payload could not be read: nesting too deep")
        } catch (e: Exception) {
            marker("payload could not be read: ${describe(e)}")
        } catch (e: LinkageError) {
            marker("payload could not be read: ${describe(e)}")
        }

    private inner class Walk(private val limits: Limits) {
        private val path = IdentityHashMap<Any, Unit>()
        private var budget = limits.maxTotalSize

        fun copy(value: Any?, depth: Int, convert: Boolean = true): Any? {
            if (value == null) return null
            if (value is FrozenMap || value is FrozenList) return value.also { budget -= 1 }
            if (budget <= 0) return marker(tooLarge())
            budget -= 1
            return try {
                copyValue(value, depth, convert)
            } catch (e: StackOverflowError) {
                marker("${value.javaClass.name} could not be read: nesting too deep")
            } catch (e: Exception) {
                marker("${value.javaClass.name} could not be read: ${describe(e)}")
            } catch (e: LinkageError) {
                marker("${value.javaClass.name} could not be read: ${describe(e)}")
            }
        }

        private fun copyValue(value: Any, depth: Int, convert: Boolean): Any? {
            if (convert) {
                converterFor(value)?.let { converter ->
                    return copy(converter.apply(value), depth, convert = false)
                }
            }
            when (value) {
                is String -> return text(value)
                is CharSequence -> return text(value.toString())
                is Char -> return value.toString()
                is Boolean -> return value
                is Byte, is Short, is Int, is Long -> return (value as Number).toLong()
                is Float -> return finite(value.toDouble(), value.toString())
                is Double -> return finite(value, value.toString())
                is BigInteger, is BigDecimal -> return value
                is Number -> return number(value)
                is Enum<*> -> return value.name
                is ByteArray -> return bytes(value)
                is ByteBuffer -> return bytes(value.duplicate().let { b -> ByteArray(b.remaining()).also { b.get(it) } })
                is AtomicBoolean -> return value.get()
                is Optional<*> -> return copy(value.orElse(null), depth)
                is OptionalInt -> return if (value.isPresent) value.asInt.toLong() else null
                is OptionalLong -> return if (value.isPresent) value.asLong else null
                is OptionalDouble -> return if (value.isPresent) finite(value.asDouble, value.asDouble.toString()) else null
                is AtomicReference<*> -> return copy(value.get(), depth)
                is TemporalAccessor, is TemporalAmount -> return text(value.toString())
                is Date -> return text(runCatching { value.toInstant().toString() }.getOrElse { value.toString() })
                is Calendar -> return text(value.toInstant().toString())
                is Class<*> -> return value.name
                is Throwable -> return throwable(value)
            }
            if (isPlainValue(value)) return safeString(value)
            if (depth >= limits.maxDepth) return marker("max depth ${limits.maxDepth} reached")
            if (path.put(value, Unit) != null) return marker("cycle back to ${value.javaClass.name}")
            try {
                return when (value) {
                    is Map<*, *> -> map(value, depth)
                    is Iterable<*> -> list(value.iterator(), (value as? Collection<*>)?.size, depth)
                    is Array<*> -> list(value.iterator(), value.size, depth)
                    is IntArray -> list(value.iterator(), value.size, depth)
                    is LongArray -> list(value.iterator(), value.size, depth)
                    is ShortArray -> list(value.iterator(), value.size, depth)
                    is DoubleArray -> list(value.iterator(), value.size, depth)
                    is FloatArray -> list(value.iterator(), value.size, depth)
                    is BooleanArray -> list(value.iterator(), value.size, depth)
                    is CharArray -> text(String(value))
                    is Pair<*, *> -> fields(listOf("first" to { value.first }, "second" to { value.second }), depth)
                    is Triple<*, *, *> -> fields(listOf("first" to { value.first }, "second" to { value.second }, "third" to { value.third }), depth)
                    else -> structure(value, depth)
                }
            } finally {
                path.remove(value)
            }
        }

        private fun map(value: Map<*, *>, depth: Int): Any {
            val out = LinkedHashMap<String, Any?>()
            var kept = 0
            for ((key, item) in value) {
                if (kept == limits.maxItems) {
                    out[TRUNCATED_KEY] = "${value.size - kept} more entries"
                    break
                }
                if (budget <= 0) {
                    out[TRUNCATED_KEY] = tooLarge()
                    break
                }
                out[uniqueKey(out, keyText(key, depth))] = copy(item, depth + 1)
                kept++
            }
            return FrozenMap(out)
        }

        private fun list(items: Iterator<*>, size: Int?, depth: Int): Any {
            val out = ArrayList<Any?>()
            while (items.hasNext()) {
                if (out.size == limits.maxItems) {
                    out += marker(if (size != null) "${size - out.size} more items" else "more items not read")
                    break
                }
                if (budget <= 0) {
                    out += marker(tooLarge())
                    break
                }
                out += copy(items.next(), depth + 1)
            }
            return FrozenList(out)
        }

        /** Records by component; other classes by instance field. No fields: their text. */
        private fun structure(value: Any, depth: Int): Any? {
            val type = value.javaClass
            if (type.isRecord) {
                return fields(type.recordComponents.map { c -> c.name to { c.accessor.also { it.trySetAccessible() }.invoke(value) } }, depth)
            }
            val readable = instanceFields(type)
            if (readable.isEmpty()) return safeString(value)
            return fields(readable.map { f -> f.name to { f.get(value) } }, depth)
        }

        private fun fields(readers: List<Pair<String, () -> Any?>>, depth: Int): Any {
            val out = LinkedHashMap<String, Any?>()
            for ((name, read) in readers) {
                if (out.size == limits.maxItems) {
                    out[TRUNCATED_KEY] = "${readers.size - out.size} more fields"
                    break
                }
                if (budget <= 0) {
                    out[TRUNCATED_KEY] = tooLarge()
                    break
                }
                out[name] =
                    try {
                        copy(read(), depth + 1)
                    } catch (e: Exception) {
                        marker("$name could not be read: ${describe(unwrap(e))}")
                    }
            }
            return FrozenMap(out)
        }

        private fun tooLarge() = "payload larger than ${limits.maxTotalSize} characters, rest dropped"

        private fun throwable(value: Throwable): Any =
            FrozenMap(linkedMapOf("exception" to value.javaClass.name, "message" to safe { value.message }?.let(::text)))

        private fun text(value: String): String {
            budget -= value.length.coerceAtMost(limits.maxStringLength)
            if (value.length <= limits.maxStringLength) return value
            return value.substring(0, limits.maxStringLength) + "… [lsd: truncated ${value.length - limits.maxStringLength} characters]"
        }

        private fun bytes(value: ByteArray): String {
            utf8Text(value)?.let { return text(it) }
            val encoded = Base64.getEncoder().encodeToString(value)
            val kept = encoded.take(limits.maxStringLength)
            budget -= kept.length
            val cut = if (kept.length < encoded.length) "… [lsd: truncated]" else ""
            return "[lsd: binary, ${value.size} bytes] base64:$kept$cut"
        }

        private fun safeString(value: Any): String =
            try {
                text(value.toString())
            } catch (e: Exception) {
                marker("toString() of ${value.javaClass.name} threw ${describe(e)}")
            }

        /** Strings as they are; other keys by the text of their snapshot (`1`, `RED`, `{a=1}`). */
        private fun keyText(key: Any?, depth: Int): String =
            when (key) {
                null -> "null"
                is String -> text(key)
                else -> copy(key, depth + 1)?.toString() ?: "null"
            }
    }

    @Suppress("UNCHECKED_CAST")
    private fun converterFor(value: Any): Function<Any, out Any?>? {
        if (converters.isEmpty()) return null
        val match = converters.firstOrNull { it.type.isInstance(value) } ?: return null
        return (match as Converter<Any>).convert as Function<Any, out Any?>
    }

    /** Read-only map produced by a snapshot. Snapshots are not copied again. */
    internal class FrozenMap(private val delegate: Map<String, Any?>) : Map<String, Any?> by delegate {
        override fun equals(other: Any?) = delegate == other

        override fun hashCode() = delegate.hashCode()

        override fun toString() = delegate.toString()
    }

    /** Read-only list produced by a snapshot. Snapshots are not copied again. */
    internal class FrozenList(private val delegate: List<Any?>) : List<Any?> by delegate {
        override fun equals(other: Any?) = delegate == other

        override fun hashCode() = delegate.hashCode()

        override fun toString() = delegate.toString()
    }

    internal companion object {
        /** Key added to a map or object whose remaining entries were dropped. */
        const val TRUNCATED_KEY: String = "[lsd: truncated]"

        /** Default limits and no converters. Used for data that was never captured. */
        val default: PayloadConverters = PayloadConverters(Limits())

        private val opaquePackages = listOf("java.", "javax.", "jdk.", "sun.", "com.sun.", "kotlin.", "kotlinx.", "scala.", "groovy.")

        internal fun marker(text: String) = "[lsd: $text]"

        private fun finite(value: Double, raw: String): Any = if (value.isFinite()) value else raw

        private fun number(value: Number): Any =
            runCatching { BigDecimal(value.toString()) }.getOrElse { value.toString() }

        /** JDK, Kotlin and other library value types: use their text, never their fields. */
        private fun isPlainValue(value: Any): Boolean {
            if (value is Map<*, *> || value is Iterable<*> || value is Array<*>) return false
            if (value is Pair<*, *> || value is Triple<*, *, *>) return false
            val type = value.javaClass
            if (type.isArray || type.isRecord) return false
            val name = type.name
            return opaquePackages.any { name.startsWith(it) }
        }

        private val fieldCache = java.util.concurrent.ConcurrentHashMap<Class<*>, List<Field>>()

        private fun instanceFields(type: Class<*>): List<Field> =
            fieldCache.computeIfAbsent(type) {
                val out = ArrayList<Field>()
                var current: Class<*>? = type
                while (current != null && opaquePackages.none { current!!.name.startsWith(it) }) {
                    current.declaredFields
                        .filter { f ->
                            !Modifier.isStatic(f.modifiers) && !Modifier.isTransient(f.modifiers) && !f.isSynthetic &&
                                '$' !in f.name
                        }.filter { f -> runCatching { f.trySetAccessible() }.getOrDefault(false) }
                        .let { out.addAll(0, it) }
                    current = current.superclass
                }
                out
            }

        private fun utf8Text(bytes: ByteArray): String? {
            val decoded =
                try {
                    Charsets.UTF_8
                        .newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(bytes))
                        .toString()
                } catch (_: CharacterCodingException) {
                    return null
                }
            val binary = decoded.any { it.code < 0x20 && it != '\n' && it != '\r' && it != '\t' }
            return if (binary) null else decoded
        }

        private fun uniqueKey(out: Map<String, Any?>, key: String): String {
            if (key !in out) return key
            var n = 2
            while ("$key #$n" in out) n++
            return "$key #$n"
        }

        private fun unwrap(e: Throwable): Throwable =
            if (e is java.lang.reflect.InvocationTargetException) e.targetException ?: e else e

        private fun describe(e: Throwable): String {
            val message = safe { e.message }?.take(200)
            return if (message.isNullOrBlank()) e.javaClass.name else "${e.javaClass.name}: $message"
        }

        private inline fun <T> safe(block: () -> T): T? =
            try {
                block()
            } catch (_: Exception) {
                null
            }
    }
}
