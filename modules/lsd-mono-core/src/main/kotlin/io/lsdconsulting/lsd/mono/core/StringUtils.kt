package io.lsdconsulting.lsd.mono.core

fun String.escapeHtml(): String =
    toCharArray()
        .map { char ->
            when (char) {
                '<' -> "&lt;"
                '>' -> "&gt;"
                '&' -> "&amp;"
                '\"' -> "&quot;"
                '\'' -> "&#x27;"
                else -> char.toString()
            }
        }.joinToString(separator = "")

private const val ELLIPSIS = "..."

/**
 * Truncate to [maxWidth] characters, appending an ellipsis when the string is longer.
 * Blank input is returned trimmed. Widths shorter than the ellipsis are a hard cut.
 */
fun String.abbreviate(maxWidth: Int): String {
    val trimmed = trim()
    if (trimmed.isBlank() || trimmed.length <= maxWidth) return trimmed
    if (maxWidth <= 0) return ""
    if (ELLIPSIS.length >= maxWidth) return trimmed.substring(0, maxWidth)
    return trimmed.substring(0, maxWidth - ELLIPSIS.length) + ELLIPSIS
}
