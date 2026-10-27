package io.github.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import java.util.Optional

class SummariesTest {
    private data class Order(
        val id: Int,
    )

    private class Opaque

    @Test
    fun `values are shown, containers are counted, entities use their own toString or type`() {
        assertEquals("null", Summaries.of(null))
        assertEquals("\"lamp-01\"", Summaries.of("lamp-01"))
        assertEquals("42", Summaries.of(42))
        assertEquals("Optional[Order(id=7)]", Summaries.of(Optional.of(Order(7))))
        assertEquals("Optional.empty", Summaries.of(Optional.empty<Any>()))
        assertEquals("List(2)", Summaries.of(listOf(1, 2)))
        assertEquals("Set(1)", Summaries.of(setOf(1)))
        assertEquals("Map(0)", Summaries.of(emptyMap<String, String>()))
        assertEquals("Opaque", Summaries.of(Opaque()))
    }

    @Test
    fun `long text is cut`() {
        val summary = Summaries.of("x".repeat(500))
        assertEquals(Summaries.MAX, summary.length)
        assertEquals('…', summary[summary.length - 2])
    }
}
