package io.github.lsdconsulting.lsd.mono.jvm.live

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class LiveJsonTest {
    @Test
    fun `compact keeps whitespace inside strings and drops it outside`() {
        assertEquals("""{"a":"x y","b":[1,2]}""", LiveJson.compact("{ \"a\" : \"x y\",\n  \"b\": [ 1, 2 ] }"))
    }

    @Test
    fun `members and items keep each value's text, escapes and nesting included`() {
        val obj = LiveJson.compact("""{"s":"a \"q\" , } ]","n":-1.5e3,"o":{"k":[{"x":"]"}]},"a":[],"t":true,"z":null}""")
        val members = LiveJson.members(obj)
        assertEquals(listOf("s", "n", "o", "a", "t", "z"), members.keys.toList())
        assertEquals(""""a \"q\" , } ]"""", members["s"])
        assertEquals("-1.5e3", members["n"])
        assertEquals("""{"k":[{"x":"]"}]}""", members["o"])
        assertEquals(emptyList<String>(), LiveJson.items(members.getValue("a")))
        assertEquals(listOf("1", "\"a,b\"", "{\"c\":[2]}"), LiveJson.items("""[1,"a,b",{"c":[2]}]"""))
        assertEquals(emptyMap<String, String>(), LiveJson.members("{}"))
    }

    @Test
    fun `compact and members handle escaped quotes and backslashes next to whitespace`() {
        val text = "{ \"a\" : \"say \\\" hi \\\" \" ,\n \"b\" : \"C:\\\\ dir \\\\\" , \"c\" : [ 1 ] }"
        val compact = LiveJson.compact(text)
        assertEquals("{\"a\":\"say \\\" hi \\\" \",\"b\":\"C:\\\\ dir \\\\\",\"c\":[1]}", compact)
        val members = LiveJson.members(compact)
        assertEquals(listOf("a", "b", "c"), members.keys.toList())
        assertEquals("\"say \\\" hi \\\" \"", members["a"])
        assertEquals("\"C:\\\\ dir \\\\\"", members["b"])
        assertEquals("[1]", members["c"])
    }
}
