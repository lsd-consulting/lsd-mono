package io.lsdconsulting.lsd.mono.junitjupiter

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class DeCamelCaseTest {

    @Test
    fun `deCamelCase formats display names`() {
        assertEquals("hello world", "helloWorld".deCamelCase())
    }
}
