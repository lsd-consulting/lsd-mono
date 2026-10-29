package io.github.lsdconsulting.lsd.mono.jvm

/*
 * The public value classes here (Interaction, Participant, ScenarioError) define equals, hashCode
 * and toString from one list of their fields, as report-model does (#118). A data class would
 * generate these along with a public constructor, `copy` and `componentN` functions that break
 * callers each time a field is added.
 */

/** `Name(field=value, …)`, as a data class would print it, leaving out null fields. */
internal fun describe(
    name: String,
    fields: List<Pair<String, Any?>>,
): String = fields.filterNot { (_, value) -> value == null }.joinToString(", ", "$name(", ")") { (key, value) -> "$key=$value" }
