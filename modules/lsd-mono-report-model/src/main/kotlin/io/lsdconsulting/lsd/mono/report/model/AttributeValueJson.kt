package io.lsdconsulting.lsd.mono.report.model

/**
 * One attribute's value, as OpenTelemetry's are: a String, a Boolean, a whole number, a floating
 * point number, or a list of one of those. Make one with [of] or, for a list, [ofStrings],
 * [ofBooleans], [ofLongs] or [ofDoubles]; nothing else can be written.
 *
 * A message's attributes ([MessageEventJson.attributes]) and a participant's
 * ([ParticipantJson.attributes]) are keyed by OpenTelemetry semantic convention names where there
 * is one, such as `http.route`, `messaging.destination.name` or, on a participant, `service.name`.
 * Keys starting `lsd.` are kept for lsd-mono's own.
 */
@ExperimentalLsdReportModel
public class AttributeValueJson private constructor(
    /** The value: a String, Boolean, Long or Double, or a List of one of those. */
    public val value: Any,
) {
    override fun equals(other: Any?): Boolean = other is AttributeValueJson && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = "AttributeValueJson($value)"

    public companion object {
        @JvmStatic
        public fun of(value: String): AttributeValueJson = AttributeValueJson(value)

        @JvmStatic
        public fun of(value: Boolean): AttributeValueJson = AttributeValueJson(value)

        @JvmStatic
        public fun of(value: Long): AttributeValueJson = AttributeValueJson(value)

        /** An Int, kept as a Long: `of(200)` for an HTTP status code. */
        @JvmStatic
        public fun of(value: Int): AttributeValueJson = AttributeValueJson(value.toLong())

        /** A finite number: JSON has no NaN or infinity. */
        @JvmStatic
        public fun of(value: Double): AttributeValueJson = AttributeValueJson(finite(value))

        @JvmStatic
        public fun ofStrings(values: List<String>): AttributeValueJson = AttributeValueJson(values.toList())

        @JvmStatic
        public fun ofBooleans(values: List<Boolean>): AttributeValueJson = AttributeValueJson(values.toList())

        @JvmStatic
        public fun ofLongs(values: List<Long>): AttributeValueJson = AttributeValueJson(values.toList())

        /** Finite numbers: JSON has no NaN or infinity. */
        @JvmStatic
        public fun ofDoubles(values: List<Double>): AttributeValueJson = AttributeValueJson(values.map(::finite))

        private fun finite(value: Double): Double {
            require(value.isFinite()) { "An attribute value is a finite number, not $value" }
            return value
        }
    }
}

/** An attribute key is not empty: the schema has none. */
internal fun requireAttributeKey(key: String) {
    require(key.isNotEmpty()) { "An attribute key is not empty" }
}
