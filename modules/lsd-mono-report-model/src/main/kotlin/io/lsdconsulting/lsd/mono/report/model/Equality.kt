package io.lsdconsulting.lsd.mono.report.model

/*
 * The model's plain classes (#118) define equals, hashCode and toString from one list of their
 * fields, named as the schema names them. A data class would generate these, along with the
 * constructor, `copy` and `componentN` functions that break callers each time a field is added.
 */

/** `Name(field=value, …)`, as a data class would print it, leaving out null and empty fields. */
internal fun describe(
    name: String,
    fields: List<Pair<String, Any?>>,
): String =
    fields
        .filterNot { (_, value) -> value == null || (value is Collection<*> && value.isEmpty()) || (value is Map<*, *> && value.isEmpty()) }
        .joinToString(", ", "$name(", ")") { (key, value) -> "$key=$value" }
