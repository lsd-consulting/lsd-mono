package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdKey
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import java.lang.reflect.Field
import java.lang.reflect.Modifier
import java.math.BigDecimal
import java.math.BigInteger
import java.nio.ByteBuffer
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
import java.util.function.Predicate

/** Key names redacted by default (see [PayloadConverters]). The lsd-mono-jvm README lists the same names. */
internal val DEFAULT_REDACTED_KEYS: List<String> =
    listOf("password", "passwd", "secret", "token", "authorization", "apiKey", "api_key", "cookie", "set-cookie")

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
 * **Redaction.** A value whose key looks like a secret is written as `[lsd: redacted]`.
 * The key is a map key (header maps included), an object field or a record component.
 * Matching uses the key as captured, from one read. A string is matched before its
 * display is shortened. Any other key is matched on the text of that read. When the
 * read cannot see the whole key — the byte cap, the item or depth cap, the size budget,
 * a cycle back to an object already being read, or a failure while reading it — the value
 * is redacted and a [redactWhen] rule is not
 * asked to judge the partial text. A redacted value is not read.
 * Keys are compared ignoring case and the separators `-`, `_`, `.` and spaces, and a key
 * matches a name when it equals it or ends with it: `token` also covers `accessToken`
 * and `refresh_token`, and `apiKey` covers `X-Api-Key`. Built in, on by default:
 * `password`, `passwd`, `secret`, `token`, `authorization`, `apiKey`, `api_key`, `cookie`, `set-cookie`. Turn the built-in names off with `lsd.mono.payload.redact=false`
 * and add names with `lsd.mono.payload.redactKeys` (see [LsdProperties]); add rules in code
 * with [redact] and [redactWhen]. Only keys are checked: secrets inside free text (a raw
 * JSON body held as a `String`, an exception message) are not found. Convert such a body
 * to a map with [register] so its keys are checked.
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
 *   `[lsd: binary, N bytes] base64:...`. A `ByteBuffer`'s position is not moved. At most
 *   `maxStringLength * 4` bytes are read, so a large body is never decoded whole.
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
    @Volatile internal var redaction: Redaction = Redaction.fromProperties(),
) {
    /**
     * The key names redacted without any code: the built-in names unless switched off,
     * plus `lsd.mono.payload.redactKeys`. Stored normalised (see [normaliseKey]).
     */
    internal data class Redaction(
        val keys: Set<String> = DEFAULT_REDACTED_KEYS.mapTo(LinkedHashSet(), ::normaliseKey),
    ) {
        companion object {
            fun fromProperties(): Redaction {
                val defaults = if (LsdProperties.redactDefaults()) DEFAULT_REDACTED_KEYS else emptyList()
                return Redaction((defaults + LsdProperties.redactKeys()).mapTo(LinkedHashSet(), ::normaliseKey))
            }
        }
    }

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

    /** Remove every registered converter. Redaction rules are kept; see [clearRedaction]. */
    public fun clear(): Unit = converters.clear()

    private val redactedKeys = CopyOnWriteArrayList<String>()
    private val redactRules = CopyOnWriteArrayList<Predicate<String>>()

    /**
     * Also redact values under these key names, matched like the built-in ones
     * (ignoring case and separators, equal or as a suffix): `lsd.payloads.redact("ssn", "pin")`.
     */
    public fun redact(vararg keys: String): PayloadConverters =
        apply { keys.map(::normaliseKey).filter { it.isNotEmpty() }.let(redactedKeys::addAll) }

    /**
     * Also redact a value when [rule] returns true for its key, given exactly as captured
     * (a map key's text, or a field name), not the shortened display:
     * `lsd.payloads.redactWhen { it.startsWith("x-internal-") }`.
     * A rule that throws redacts. A key that could not be fully read is redacted
     * without asking the rule.
     */
    public fun redactWhen(rule: Predicate<String>): PayloadConverters = apply { redactRules.add(rule) }

    /** Remove the rules added with [redact] and [redactWhen]. The property-driven names stay. */
    public fun clearRedaction() {
        redactedKeys.clear()
        redactRules.clear()
    }

    /** Whether a value under [key] is written as [REDACTED]. */
    internal fun isRedacted(key: String): Boolean {
        val normal = normaliseKey(key)
        if (normal.isNotEmpty()) {
            if (redaction.keys.any { normal.endsWith(it) }) return true
            if (redactedKeys.any { normal.endsWith(it) }) return true
        }
        return redactRules.any { rule ->
            try {
                rule.test(key)
            } catch (_: Exception) {
                true
            }
        }
    }

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

        /**
         * When [keyRead] is set, this read decides whether that key is complete.
         * A [FrozenMap] or [FrozenList] produced by an earlier snapshot is already text:
         * it is treated as complete, even when that text was shortened.
         */
        fun copy(value: Any?, depth: Int, convert: Boolean = true, keyRead: KeyRead? = null): Any? {
            if (value == null) return null
            if (value is FrozenMap || value is FrozenList) return value.also { budget -= 1 }
            if (budget <= 0) {
                keyRead?.complete = false
                return marker(tooLarge())
            }
            budget -= 1
            return try {
                copyValue(value, depth, convert, keyRead)
            } catch (e: StackOverflowError) {
                keyRead?.complete = false
                marker("${value.javaClass.name} could not be read: nesting too deep")
            } catch (e: Exception) {
                keyRead?.complete = false
                marker("${value.javaClass.name} could not be read: ${describe(e)}")
            } catch (e: LinkageError) {
                keyRead?.complete = false
                marker("${value.javaClass.name} could not be read: ${describe(e)}")
            }
        }

        private fun copyValue(value: Any, depth: Int, convert: Boolean, keyRead: KeyRead?): Any? {
            if (convert) {
                converterFor(value)?.let { converter ->
                    return copy(converter.apply(value), depth, convert = false, keyRead = keyRead)
                }
            }
            when (value) {
                is String -> return text(value, keyRead)
                is CharSequence -> return text(value.toString(), keyRead)
                is Char -> return value.toString()
                is Boolean -> return value
                is Byte, is Short, is Int, is Long -> return (value as Number).toLong()
                is Float -> return finite(value.toDouble(), value.toString())
                is Double -> return finite(value, value.toString())
                is BigInteger, is BigDecimal -> return value
                is Number -> return number(value)
                is Enum<*> -> return value.name
                is ByteArray -> return bytes(ByteBuffer.wrap(value), keyRead)
                is ByteBuffer -> return bytes(value.duplicate(), keyRead)
                is AtomicBoolean -> return value.get()
                is Optional<*> -> return copy(value.orElse(null), depth, keyRead = keyRead)
                is OptionalInt -> return if (value.isPresent) value.asInt.toLong() else null
                is OptionalLong -> return if (value.isPresent) value.asLong else null
                is OptionalDouble -> return if (value.isPresent) finite(value.asDouble, value.asDouble.toString()) else null
                is AtomicReference<*> -> return copy(value.get(), depth, keyRead = keyRead)
                is TemporalAccessor, is TemporalAmount -> return text(value.toString(), keyRead)
                is Date -> return text(runCatching { value.toInstant().toString() }.getOrElse { value.toString() }, keyRead)
                is Calendar -> return text(value.toInstant().toString(), keyRead)
                is Class<*> -> return value.name
                is Throwable -> return throwable(value, keyRead)
            }
            if (isPlainValue(value)) return safeString(value, keyRead)
            if (depth >= limits.maxDepth) {
                keyRead?.complete = false
                return marker("max depth ${limits.maxDepth} reached")
            }
            if (path.put(value, Unit) != null) {
                keyRead?.complete = false
                return marker("cycle back to ${value.javaClass.name}")
            }
            try {
                return when (value) {
                    is Map<*, *> -> map(value, depth, keyRead)
                    is Iterable<*> -> list(value.iterator(), (value as? Collection<*>)?.size, depth, keyRead)
                    is Array<*> -> list(value.iterator(), value.size, depth, keyRead)
                    is IntArray -> list(value.iterator(), value.size, depth, keyRead)
                    is LongArray -> list(value.iterator(), value.size, depth, keyRead)
                    is ShortArray -> list(value.iterator(), value.size, depth, keyRead)
                    is DoubleArray -> list(value.iterator(), value.size, depth, keyRead)
                    is FloatArray -> list(value.iterator(), value.size, depth, keyRead)
                    is BooleanArray -> list(value.iterator(), value.size, depth, keyRead)
                    is CharArray -> text(String(value), keyRead)
                    is Pair<*, *> -> fields(listOf("first" to { value.first }, "second" to { value.second }), depth, keyRead)
                    is Triple<*, *, *> -> fields(listOf("first" to { value.first }, "second" to { value.second }, "third" to { value.third }), depth, keyRead)
                    else -> structure(value, depth, keyRead)
                }
            } finally {
                path.remove(value)
            }
        }

        /** A map used as a value, or as a key when [keyRead] is set (then a [Both] of identity and display). */
        private fun map(value: Map<*, *>, depth: Int, keyRead: KeyRead?): Any {
            val identity = LinkedHashMap<String, Any?>()
            val display = if (keyRead != null) LinkedHashMap<String, Any?>() else identity
            var kept = 0
            for ((key, item) in value) {
                if (kept == limits.maxItems) {
                    putTruncated(identity, display, keyRead, "${value.size - kept} more entries")
                    break
                }
                if (budget <= 0) {
                    putTruncated(identity, display, keyRead, tooLarge())
                    break
                }
                if (keyRead != null) {
                    putMapKeyEntry(identity, display, key, item, depth, keyRead)
                } else {
                    val match = keyMatch(key, depth)
                    val redacted = match.identity == null || isRedacted(match.identity)
                    identity[uniqueKey(identity, match.display)] = if (redacted) REDACTED else copy(item, depth + 1)
                }
                kept++
            }
            return if (keyRead != null) Both(FrozenMap(identity), FrozenMap(display)) else FrozenMap(identity)
        }

        private fun putMapKeyEntry(
            identity: LinkedHashMap<String, Any?>,
            display: LinkedHashMap<String, Any?>,
            key: Any?,
            item: Any?,
            depth: Int,
            keyRead: KeyRead,
        ) {
            val names = namesOf(key, depth)
            if (names.identity != null && isRedacted(names.identity)) {
                identity[uniqueKey(identity, names.identity)] = REDACTED
                display[uniqueKey(display, names.display)] = REDACTED
            } else {
                if (names.identity == null) keyRead.complete = false
                val child = if (names.identity == null) REDACTED else copy(item, depth + 1, keyRead = keyRead)
                // No identity text for an incomplete nested key. Its display text is kept only
                // so the key can still be shown; this key is incomplete, so the value is redacted.
                val shown = if (names.identity == null) names.display else names.identity
                identity[uniqueKey(identity, shown)] = plainIdentity(child)
                display[uniqueKey(display, names.display)] = plainDisplay(child)
            }
        }

        /** A list used as a value, or as a key when [keyRead] is set (then a [Both] of identity and display). */
        private fun list(items: Iterator<*>, size: Int?, depth: Int, keyRead: KeyRead?): Any {
            val identity = ArrayList<Any?>()
            val display = if (keyRead != null) ArrayList<Any?>() else identity
            while (items.hasNext()) {
                if (identity.size == limits.maxItems) {
                    val rest = marker(if (size != null) "${size - identity.size} more items" else "more items not read")
                    appendTruncated(identity, display, keyRead, rest)
                    break
                }
                if (budget <= 0) {
                    appendTruncated(identity, display, keyRead, marker(tooLarge()))
                    break
                }
                val child = copy(items.next(), depth + 1, keyRead = keyRead)
                if (keyRead != null) {
                    identity += plainIdentity(child)
                    display += plainDisplay(child)
                } else {
                    identity += child
                }
            }
            return if (keyRead != null) Both(FrozenList(identity), FrozenList(display)) else FrozenList(identity)
        }

        /** Records by component; other classes by instance field. No fields: their text. */
        private fun structure(value: Any, depth: Int, keyRead: KeyRead?): Any? {
            val type = value.javaClass
            if (type.isRecord) {
                return fields(type.recordComponents.map { c -> c.name to { c.accessor.also { it.trySetAccessible() }.invoke(value) } }, depth, keyRead)
            }
            val readable = instanceFields(type)
            if (readable.isEmpty()) return safeString(value, keyRead)
            return fields(readable.map { f -> f.name to { f.get(value) } }, depth, keyRead)
        }

        /** Fields of a value, or of an object used as a key when [keyRead] is set. */
        private fun fields(readers: List<Pair<String, () -> Any?>>, depth: Int, keyRead: KeyRead?): Any {
            val identity = LinkedHashMap<String, Any?>()
            val display = if (keyRead != null) LinkedHashMap<String, Any?>() else identity
            for ((name, read) in readers) {
                if (identity.size == limits.maxItems) {
                    putTruncated(identity, display, keyRead, "${readers.size - identity.size} more fields")
                    break
                }
                if (budget <= 0) {
                    putTruncated(identity, display, keyRead, tooLarge())
                    break
                }
                if (isRedacted(name)) {
                    identity[name] = REDACTED
                    if (keyRead != null) display[name] = REDACTED
                    continue
                }
                val child =
                    try {
                        copy(read(), depth + 1, keyRead = keyRead)
                    } catch (e: Exception) {
                        if (keyRead != null) keyRead.complete = false
                        marker("$name could not be read: ${describe(unwrap(e))}")
                    }
                if (keyRead != null) {
                    identity[name] = plainIdentity(child)
                    display[name] = plainDisplay(child)
                } else {
                    identity[name] = child
                }
            }
            return if (keyRead != null) Both(FrozenMap(identity), FrozenMap(display)) else FrozenMap(identity)
        }

        private fun putTruncated(
            identity: LinkedHashMap<String, Any?>,
            display: LinkedHashMap<String, Any?>,
            keyRead: KeyRead?,
            rest: String,
        ) {
            if (keyRead != null) keyRead.complete = false
            identity[TRUNCATED_KEY] = rest
            if (keyRead != null) display[TRUNCATED_KEY] = rest
        }

        private fun appendTruncated(
            identity: ArrayList<Any?>,
            display: ArrayList<Any?>,
            keyRead: KeyRead?,
            rest: Any,
        ) {
            if (keyRead != null) keyRead.complete = false
            identity += rest
            if (keyRead != null) display += rest
        }

        private fun tooLarge() = "payload larger than ${limits.maxTotalSize} characters, rest dropped"

        private fun throwable(value: Throwable, keyRead: KeyRead?): Any {
            val message = safe { value.message }?.let { text(it, keyRead) }
            val identity = linkedMapOf("exception" to value.javaClass.name, "message" to plainIdentity(message))
            if (keyRead == null) return FrozenMap(identity)
            return Both(FrozenMap(identity), FrozenMap(linkedMapOf("exception" to value.javaClass.name, "message" to plainDisplay(message))))
        }

        private fun text(value: String, keyRead: KeyRead? = null): Any {
            budget -= value.length.coerceAtMost(limits.maxStringLength)
            return if (keyRead == null) shorten(value) else Kept(value)
        }

        /** Display form of [value]. Does not change the size budget. */
        private fun shorten(value: String): String {
            if (value.length <= limits.maxStringLength) return value
            return value.substring(0, limits.maxStringLength) + "… [lsd: truncated ${value.length - limits.maxStringLength} characters]"
        }

        /**
         * Reads at most [maxBytes] bytes of [buffer], so a large body is never decoded or
         * base64-encoded whole. That is enough UTF-8 for [Limits.maxStringLength] characters.
         */
        private fun bytes(buffer: ByteBuffer, keyRead: KeyRead?): Any {
            val size = buffer.remaining()
            val maxBytes = (limits.maxStringLength.toLong() * 4).coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
            val cut = size > maxBytes
            if (cut) keyRead?.complete = false
            val head = ByteArray(if (cut) utf8Boundary(buffer, maxBytes) else size).also { buffer.get(it) }
            utf8Text(head)?.let { decoded ->
                if (!cut) return text(decoded, keyRead)
                var end = decoded.length.coerceAtMost(limits.maxStringLength)
                if (end in 1 until decoded.length && decoded[end - 1].isHighSurrogate()) end--
                val kept = decoded.substring(0, end)
                budget -= end
                return kept + "… [lsd: truncated, $size bytes in total]"
            }
            val keep = (limits.maxStringLength.toLong() * 3 / 4).toInt().coerceAtMost(head.size)
            val encoded = Base64.getEncoder().encodeToString(head.copyOf(keep)).take(limits.maxStringLength)
            budget -= encoded.length
            val marker = if (keep < size) "… [lsd: truncated]" else ""
            val display = "[lsd: binary, $size bytes] base64:$encoded$marker"
            if (keyRead != null && keyRead.complete) {
                val full = Base64.getEncoder().encodeToString(head)
                return Both("[lsd: binary, $size bytes] base64:$full", display)
            }
            return display
        }

        /**
         * The length of [buffer]'s first [max] bytes, shortened so it does not end inside a
         * UTF-8 character: a truncated character would make text look like binary.
         */
        private fun utf8Boundary(buffer: ByteBuffer, max: Int): Int {
            val start = buffer.position()
            var end = max
            // Back off over up to three continuation bytes (10xxxxxx) to the start of the character at max.
            while (end > max - 4 && end > 0 && (buffer.get(start + end).toInt() and 0xC0) == 0x80) end--
            return end
        }

        private fun safeString(value: Any, keyRead: KeyRead?): Any =
            try {
                text(value.toString(), keyRead)
            } catch (e: Exception) {
                keyRead?.complete = false
                marker("toString() of ${value.javaClass.name} threw ${describe(e)}")
            }

        /**
         * Display text and, when the key was fully read, the text [isRedacted] sees.
         * [KeyMatch.identity] is null when the read was cut short or failed: the value is then
         * redacted without matching a partial name.
         */
        private fun keyMatch(key: Any?, depth: Int): KeyMatch {
            if (key == null) return KeyMatch("null", "null")
            if (key is String) return KeyMatch(key, text(key) as String)
            val read = KeyRead()
            val rendered = copy(key, depth + 1, keyRead = read)
            val display = plainDisplay(rendered)?.toString() ?: "null"
            if (!read.complete) return KeyMatch(null, display)
            return KeyMatch(plainIdentity(rendered)?.toString() ?: "null", display)
        }

        /**
         * One read of a nested key while a map is being used as a key.
         * [map] marks this key incomplete when the result has no identity.
         */
        private fun namesOf(key: Any?, depth: Int): KeyMatch {
            if (key == null) return KeyMatch("null", "null")
            if (key is String) {
                budget -= key.length.coerceAtMost(limits.maxStringLength)
                return KeyMatch(key, shorten(key))
            }
            val nested = KeyRead()
            val rendered = copy(key, depth + 1, keyRead = nested)
            val display = plainDisplay(rendered)?.toString() ?: "null"
            if (!nested.complete) return KeyMatch(null, display)
            return KeyMatch(plainIdentity(rendered)?.toString() ?: "null", display)
        }

        private fun plainIdentity(value: Any?): Any? = when (value) {
            is Kept -> value.value
            is Both -> value.identity
            else -> value
        }

        private fun plainDisplay(value: Any?): Any? = when (value) {
            is Kept -> shorten(value.value)
            is Both -> value.display
            else -> value
        }
    }

    /** Set false when a key read stops early or fails. One per read, not a mode flag on [Walk]. */
    private class KeyRead {
        var complete: Boolean = true
    }

    /** A string kept whole so matching is not the shortened display. */
    private class Kept(val value: String)

    /** Identity and display produced by one read of a composite key. */
    private class Both(val identity: Any?, val display: Any?)

    /** [identity] null means the key could not be fully read, so the value is redacted. */
    private class KeyMatch(val identity: String?, val display: String)

    @Suppress("UNCHECKED_CAST")
    private fun converterFor(value: Any): Function<Any, out Any?>? {
        if (converters.isEmpty()) return null
        val match = converters.firstOrNull { it.type.isInstance(value) } ?: return null
        return (match as Converter<Any>).convert
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
        /** Written in place of a value whose key is redacted. */
        const val REDACTED: String = "[lsd: redacted]"

        /** Key added to a map or object whose remaining entries were dropped. */
        const val TRUNCATED_KEY: String = "[lsd: truncated]"

        /** Default limits and no converters. Used for data that was never captured. */
        val default: PayloadConverters = PayloadConverters(Limits())

        private val opaquePackages = listOf("java.", "javax.", "jdk.", "sun.", "com.sun.", "kotlin.", "kotlinx.", "scala.", "groovy.")

        internal fun marker(text: String) = "[lsd: $text]"

        /** Lower case without `-`, `_`, `.` or whitespace: `X-Api-Key` and `api_key` both become `xapikey` / `apikey`. */
        internal fun normaliseKey(key: String): String = key.lowercase().filterNot { it == '-' || it == '_' || it == '.' || it.isWhitespace() }

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

        /**
         * Each class's readable instance fields, worked out once. A [ClassValue] keeps them
         * with the class itself, so a class (and its class loader) can still be unloaded,
         * as under hot reload; a map keyed by `Class` would keep every one reachable.
         */
        private val fieldCache =
            object : ClassValue<List<Field>>() {
                override fun computeValue(type: Class<*>): List<Field> {
                    val out = ArrayList<Field>()
                    var current: Class<*>? = type
                    while (current != null && opaquePackages.none { current.name.startsWith(it) }) {
                        current.declaredFields
                            .filter { f ->
                                !Modifier.isStatic(f.modifiers) && !Modifier.isTransient(f.modifiers) && !f.isSynthetic &&
                                    '$' !in f.name
                            }.filter { f -> runCatching { f.trySetAccessible() }.getOrDefault(false) }
                            .let { out.addAll(0, it) }
                        current = current.superclass
                    }
                    return out
                }
            }

        private fun instanceFields(type: Class<*>): List<Field> = fieldCache.get(type)

        @OptIn(InternalLsdApi::class)
        private fun utf8Text(bytes: ByteArray): String? {
            val decoded = JsonText.decodeUtf8(bytes) ?: return null
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
