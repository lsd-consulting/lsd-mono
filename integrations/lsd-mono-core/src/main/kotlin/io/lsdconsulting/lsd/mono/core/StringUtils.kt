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
