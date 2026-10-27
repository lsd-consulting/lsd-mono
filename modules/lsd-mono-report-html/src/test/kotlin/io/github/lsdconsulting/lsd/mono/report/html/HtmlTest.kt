package io.github.lsdconsulting.lsd.mono.report.html

import io.github.lsdconsulting.lsd.mono.report.model.testing.assertValidJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** One escaper per context (#28). lsd-mono-jvm's HtmlEscapingTest writes a whole hostile report. */
class HtmlTest {
    @Test
    fun `text escapes ampersand and angle brackets only`() {
        assertEquals("&lt;a href=\"x\"&gt;Tom &amp; Jerry's&lt;/a&gt;", Html.text("<a href=\"x\">Tom & Jerry's</a>"))
        assertEquals("&lt;/script&gt;&lt;!--", Html.text("</script><!--"))
        assertEquals("&amp;amp;", Html.text("&amp;"))
        assertEquals("", Html.text(null))
        assertEquals("plain", Html.text("plain"))
    }

    @Test
    fun `attribute escapes quotes too`() {
        assertEquals("&quot;x&quot; onmouseover=&#39;y&#39; &lt;&amp;&gt;", Html.attribute("\"x\" onmouseover='y' <&>"))
        assertEquals("", Html.attribute(null))
    }

    @Test
    fun `both keep whitespace, U+2028 and pairs, and replace other controls and lone surrogates`() {
        val awkward = "a\u2028b\u2029c\t\n\r\u000C \u0000\u0001\u001f x\uD800y\uDC00z \uDC00\uD800 pair \uD83D\uDE00"
        val expected = "a\u2028b\u2029c\t\n\r\u000C \uFFFD\uFFFD\uFFFD x\uFFFDy\uFFFDz \uFFFD\uFFFD pair \uD83D\uDE00"
        assertEquals(expected, Html.text(awkward))
        assertEquals(expected, Html.attribute(awkward))
        assertTrue(utf8(Html.text(awkward).toByteArray()) != null)
        assertEquals("x\uFFFDy \uD83D\uDE00", Html.wellFormed("x\uDC00y \uD83D\uDE00"))
    }

    @Test
    fun `json for script escapes markup, separators, controls and lone surrogates`() {
        val json = jsonString("</script><!-- & \u2028\u2029 \u0000\u001f \"\\ \uD800 \uD83D\uDE00")
        assertEquals(
            "\"\\u003c/script\\u003e\\u003c!-- \\u0026 \\u2028\\u2029 \\u0000\\u001f \\\"\\\\ \\ufffd \uD83D\uDE00\"",
            json,
        )
        assertValidJson(json)
    }

    private fun utf8(bytes: ByteArray): String? =
        try {
            Charsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        } catch (_: Exception) {
            null
        }
}
