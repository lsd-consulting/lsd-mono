package io.github.lsdconsulting.lsd.mono.jvm

import io.github.lsdconsulting.lsd.mono.jvm.PayloadConverters.Companion.REDACTED
import io.github.lsdconsulting.lsd.mono.jvm.PayloadConverters.Limits
import io.github.lsdconsulting.lsd.mono.jvm.PayloadConverters.Redaction
import io.github.lsdconsulting.lsd.mono.jvm.domain.Message
import io.github.lsdconsulting.lsd.mono.jvm.properties.LsdProperties
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.ByteBuffer
import java.nio.file.Files
import java.nio.file.Path
import java.util.IdentityHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.io.path.listDirectoryEntries
import kotlin.io.path.name
import kotlin.io.path.readText

/** Secrets in message data are written as `[lsd: redacted]` (#43). */
@LsdTestConfig
class PayloadRedactionTest {
    @TempDir
    lateinit var tempDir: Path

    private val converters = PayloadConverters(Limits(), Redaction())

    private fun snap(value: Any?): Any? = converters.snapshot(value)

    data class Login(val user: String, val password: String, val apiKey: String?, val profile: Profile)

    data class Profile(val name: String, val sessionToken: String)

    @JvmRecord
    data class Card(val number: String, val secret: String)

    /** No fields, so a map key is this text. */
    class TraceKey {
        override fun toString(): String = "X-Trace-Label"
    }

    /** Structured map key. Its display text is the field map, which a short limit shortens. */
    data class HeaderName(val raw: String)

    /** Two fields, so an item cap of one hides the second. */
    data class ItemKey(val first: String, val second: String)

    /** A password field inside an object used as a map key. */
    data class FieldSecret(val user: String, val password: String)

    /** No fields, so the key is its text, and that text cannot be read. */
    class UnreadableKey {
        override fun toString(): String = error("unreadable")
    }

    /** No fields. [reads] counts toString calls, including a second call that throws. */
    class OnceName {
        override fun toString(): String {
            val n = reads.incrementAndGet()
            if (n > 1) error("second read")
            return "Proxy-Authorization"
        }

        companion object {
            val reads = AtomicInteger()
        }
    }

    @Test
    fun `every built-in name is redacted in maps, ignoring case and separators`() {
        val headers =
            linkedMapOf(
                "Authorization" to "Bearer abc",
                "Cookie" to "sid=1",
                "Set-Cookie" to listOf("sid=2"),
                "X-API-KEY" to "k",
                "api_key" to "k2",
                "PASSWD" to "p",
                "client_secret" to "s",
                "refresh-token" to "t",
                "Content-Type" to "application/json",
            )
        assertEquals(
            mapOf(
                "Authorization" to REDACTED,
                "Cookie" to REDACTED,
                "Set-Cookie" to REDACTED,
                "X-API-KEY" to REDACTED,
                "api_key" to REDACTED,
                "PASSWD" to REDACTED,
                "client_secret" to REDACTED,
                "refresh-token" to REDACTED,
                "Content-Type" to "application/json",
            ),
            snap(headers),
        )
    }

    @Test
    fun `object fields, nested objects and records are redacted, other keys are kept`() {
        val login = Login("ann", "hunter2", null, Profile("Ann", "t-1"))
        assertEquals(
            mapOf(
                "user" to "ann",
                "password" to REDACTED,
                "apiKey" to REDACTED,
                "profile" to mapOf("name" to "Ann", "sessionToken" to REDACTED),
            ),
            snap(login),
        )
        assertEquals(mapOf("number" to "4242", "secret" to REDACTED), snap(Card("4242", "s")))
        // A name only matches as the whole key or its end: tokenType and passwordPolicy stay.
        assertEquals(mapOf("tokenType" to "Bearer", "passwordPolicy" to "strong"), snap(mapOf("tokenType" to "Bearer", "passwordPolicy" to "strong")))
    }

    @Test
    fun `a whole structure under a secret key is dropped, not walked`() {
        assertEquals(mapOf("token" to REDACTED), snap(mapOf("token" to mapOf("value" to "abc", "expires" to 3))))
    }

    @Test
    fun `code can add names and rules, and clear them`() {
        converters.redact("ssn", "X-Session")
        converters.redactWhen { it.startsWith("x-internal-") }
        converters.redactWhen { error("broken rule") } // a rule that throws redacts, to fail safe
        assertEquals(
            mapOf("ssn" to REDACTED, "x_session" to REDACTED, "x-internal-id" to REDACTED, "name" to REDACTED),
            snap(
                mapOf(
                    "ssn" to "1",
                    "x_session" to "2",
                    "x-internal-id" to "3",
                    "name" to "n",
                ),
            ),
        )
        converters.clearRedaction()
        assertEquals(mapOf("ssn" to "1", "name" to "n", "token" to REDACTED), snap(mapOf("ssn" to "1", "name" to "n", "token" to "t")))
    }

    @Test
    fun `the properties switch the built-in names off and add names`() {
        System.setProperty(LsdProperties.PAYLOAD_REDACT, "FALSE")
        System.setProperty(LsdProperties.PAYLOAD_REDACT_KEYS, " ssn , ,pin")
        val custom = PayloadConverters(Limits(), Redaction.fromProperties())
        assertEquals(mapOf("password" to "p", "ssn" to REDACTED, "PIN" to REDACTED), custom.snapshot(mapOf("password" to "p", "ssn" to "1", "PIN" to "2")))

        System.setProperty(LsdProperties.PAYLOAD_REDACT, "maybe") // not a boolean: warned about, and the default (on) is kept
        assertEquals(mapOf("password" to REDACTED), PayloadConverters(Limits(), Redaction.fromProperties()).snapshot(mapOf("password" to "p")))
    }

    @Test
    fun `captured messages and failures go through redaction, and clear re-reads the properties`() {
        System.setProperty(LsdProperties.OUTPUT_DIR, tempDir.toString())
        val lsd = LsdContext()
        val scenario = lsd.beginScenario()
        lsd.message("Client", "Api", "POST /login", data = mapOf("user" to "ann", "password" to "hunter2"))
        lsd.call("Client", "Api", "GET /me").fail(IllegalStateException("token expired"))
        val data = scenario.close().second.map { (it as Message).data }
        assertEquals(mapOf("user" to "ann", "password" to REDACTED), data[0])
        // The failure's message is free text, not a key: it is kept (see the README).
        assertEquals("token expired", (data[2] as Map<*, *>)["message"])

        System.setProperty(LsdProperties.PAYLOAD_REDACT, "false")
        lsd.clear()
        val next = lsd.beginScenario()
        lsd.message("Client", "Api", "POST /login", data = mapOf("password" to "hunter2"))
        assertEquals(mapOf("password" to "hunter2"), (next.close().second.single() as Message).data)
    }

    @Test
    fun `truncating a map key still redacts the value`() {
        val limit = 10
        val secretAuth = "sekret"
        val secretToken = "other-secret"
        val secretRequest = "synthetic-request-token"
        val secretBuried = "zq9-buried-under-authorization"
        val note = "visible-note-012345678901234"
        val snapshot =
            snap(
                linkedMapOf(
                    "Authorization" to secretAuth,
                    "token" to secretToken,
                    "X-Request-Token" to secretRequest,
                    "Content-Type" to "application/json",
                    "note" to note,
                    "refresh_token" to mapOf("raw" to secretBuried),
                ),
                limit,
            ) as Map<*, *>

        assertEquals(
            listOf(
                REDACTED,
                REDACTED,
                REDACTED,
                "applicatio… [lsd: truncated 6 characters]",
                "visible-no… [lsd: truncated 18 characters]",
                REDACTED,
            ),
            snapshot.values.toList(),
        )
        assertEquals(
            listOf(
                "Authorizat… [lsd: truncated 3 characters]",
                "token",
                shortened("X-Request-Token", limit),
                shortened("Content-Type", limit),
                "note",
                shortened("refresh_token", limit),
            ),
            snapshot.keys.toList(),
        )
        assertNoLeak(snapshot, limit, secretAuth, secretToken, secretRequest, secretBuried)
        assertFalse(snapshot.toString().contains("zq9"), snapshot.toString())

        val login = snap(Login("ann", "zq9-password-value", "zq9-apikey-value", Profile("Ann", "zq9-session-token")), limit) as Map<*, *>
        assertEquals(REDACTED, login["password"])
        assertEquals(REDACTED, login["apiKey"])
        assertEquals("ann", login["user"])
        assertEquals(mapOf("name" to "Ann", "sessionToken" to REDACTED), login["profile"])
        assertFalse(login.toString().contains("zq9"), login.toString())
    }

    @Test
    fun `every supported sensitive key is redacted at short string limits`() {
        val keys = DEFAULT_REDACTED_KEYS + longSensitiveKeys
        for (limit in listOf(0, 1, 4, 10, 13)) {
            for (key in keys) {
                val secret = "zq9-$limit-$key-value"
                val snapshot =
                    snap(
                        linkedMapOf(key to secret, "Content-Type" to "application/json"),
                        limit,
                    ) as Map<*, *>
                assertEquals(listOf(REDACTED, shortened("application/json", limit)), snapshot.values.toList(), "limit=$limit key=$key snapshot=$snapshot")
                assertEquals(shortened(key, limit), snapshot.keys.first(), "display key limit=$limit key=$key")
                assertNoLeak(snapshot, limit, secret)
            }
        }
    }

    @Test
    fun `a custom key rule sees the captured key when the display is truncated`() {
        val limit = 10
        val secret = "zq9-request-token-value"
        val seen = mutableListOf<String>()
        val payloads = PayloadConverters(Limits(maxStringLength = limit), Redaction(keys = emptySet()))
        payloads.redactWhen { key ->
            seen += key
            key == "X-Request-Token"
        }
        val snapshot =
            payloads.snapshot(
                linkedMapOf(
                    "X-Request-Token" to secret,
                    "Content-Type" to "application/json",
                ),
            ) as Map<*, *>
        assertEquals(listOf("X-Request-Token", "Content-Type"), seen)
        assertEquals(listOf(REDACTED, "applicatio… [lsd: truncated 6 characters]"), snapshot.values.toList())
        assertEquals(shortened("X-Request-Token", limit), snapshot.keys.first())
        assertNoLeak(snapshot, limit, secret)
    }

    @Test
    fun `an added redact name matches the captured key when the display is truncated`() {
        val named = PayloadConverters(Limits(maxStringLength = 10), Redaction(keys = emptySet()))
        named.redact("traceid")
        val trace = named.snapshot(linkedMapOf("user-traceid" to "zq9-traceid-value")) as Map<*, *>
        assertEquals(REDACTED, trace.values.single(), trace.toString())
        assertNoLeak(trace, 10, "zq9-traceid-value")
    }

    @Test
    fun `a rule that matches only the truncation marker does not redact a public key`() {
        val marker = PayloadConverters(Limits(maxStringLength = 10), Redaction(keys = emptySet()))
        marker.redactWhen { it.contains("… [lsd: truncated") }
        val kept = marker.snapshot(linkedMapOf("Content-Type" to "application/json")) as Map<*, *>
        assertEquals("applicatio… [lsd: truncated 6 characters]", kept.values.single())
    }

    @Test
    fun `a rule that throws redacts even when the key is longer than the string limit`() {
        val failing = PayloadConverters(Limits(maxStringLength = 10), Redaction(keys = emptySet()))
        failing.redactWhen { error("broken rule") }
        assertEquals(REDACTED, (failing.snapshot(linkedMapOf("X-Trace-Label" to "zq9-thrown-value")) as Map<*, *>).values.single())
        assertNoLeak(failing.snapshot(linkedMapOf("X-Trace-Label" to "zq9-thrown-value")), 10, "zq9-thrown-value")
    }

    @Test
    fun `nested maps and header maps stay redacted at a short limit`() {
        val limit = 10
        val secret = "zq9-nested-authorization"
        val cookies = listOf("zq9-cookie-a", "zq9-cookie-b")
        val snapshot =
            snap(
                mapOf(
                    "request" to
                        mapOf(
                            "headers" to
                                linkedMapOf(
                                    "Authorization" to secret,
                                    "Content-Type" to "application/json",
                                    "Set-Cookie" to cookies,
                                ),
                        ),
                ),
                limit,
            ) as Map<*, *>
        val headers = (snapshot["request"] as Map<*, *>)["headers"] as Map<*, *>
        assertEquals(listOf(REDACTED, shortened("application/json", limit), REDACTED), headers.values.toList(), headers.toString())
        assertEquals(shortened("Authorization", limit), headers.keys.first())
        assertNoLeak(snapshot, limit, secret, "zq9-cookie-a", "zq9-cookie-b")
        assertFalse(snapshot.toString().contains("zq9"), snapshot.toString())
    }

    @Test
    fun `a fully read non-string key is matched whole and displayed shortened`() {
        val limit = 10
        val secret = "zq9-non-string-key"
        val seen = mutableListOf<String>()
        val payloads = PayloadConverters(Limits(maxStringLength = limit), Redaction(keys = emptySet()))
        payloads.redactWhen { key ->
            seen += key
            key == "X-Trace-Label" || key == "{raw=X-Trace-Label}"
        }
        val keys =
            listOf<Any>(
                StringBuilder("X-Trace-Label"),
                "X-Trace-Label".toCharArray(),
                TraceKey(),
                "X-Trace-Label".toByteArray(),
                HeaderName("X-Trace-Label"),
            )
        for (key in keys) {
            val snapshot = payloads.snapshot(linkedMapOf(key to secret)) as Map<*, *>
            assertEquals(REDACTED, snapshot.values.single(), "key=$key snapshot=$snapshot")
            assertTrue(
                snapshot.keys
                    .single()
                    .toString()
                    .contains("… [lsd: truncated"),
                snapshot.keys.toString(),
            )
            assertNoLeak(snapshot, limit, secret)
        }
        assertEquals(4, seen.count { it == "X-Trace-Label" }, seen.toString())
        // A structured key is the field map's text. Field names are also shown to the rule.
        assertTrue(seen.contains("{raw=X-Trace-Label}"), seen.toString())
        assertFalse(seen.any { "… [lsd: truncated" in it }, seen.toString())
    }

    @Test
    fun `a character sequence key does not consume the budget twice`() {
        val beside =
            PayloadConverters(Limits(maxStringLength = 10, maxTotalSize = 20), Redaction()).snapshot(
                linkedMapOf(
                    StringBuilder("Authorization") to "zq9-non-string-key",
                    "note" to "012345678901234",
                ),
            ) as Map<*, *>
        assertEquals(REDACTED, beside.values.first(), beside.toString())
        assertEquals("0123456789… [lsd: truncated 5 characters]", beside.values.last(), beside.toString())
        assertNoLeak(beside, 10, "zq9-non-string-key")
    }

    @Test
    fun `a fully read binary key is matched without its display truncation marker`() {
        val binarySeen = mutableListOf<String>()
        val binary = PayloadConverters(Limits(maxStringLength = 4), Redaction(keys = emptySet()))
        binary.redactWhen { key ->
            binarySeen += key
            true
        }
        val binarySnapshot = binary.snapshot(linkedMapOf(byteArrayOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9) to "zq9-binary")) as Map<*, *>
        assertEquals(REDACTED, binarySnapshot.values.single(), binarySnapshot.toString())
        assertFalse(binarySeen.single().contains("truncated"), binarySeen.toString())
        assertTrue(
            binarySnapshot.keys
                .single()
                .toString()
                .contains("… [lsd: truncated]"),
            binarySnapshot.keys.toString(),
        )
        assertNoLeak(binarySnapshot, 4, "zq9-binary")
    }

    @Test
    fun `a byte key that cannot be fully read is redacted`() {
        val proxy = "Proxy-Authorization".also { assertEquals(19, it.length) }.toByteArray()
        val apiKey = "x-vendor-integration-partner-gateway-api-key".also { assertEquals(44, it.length) }.toByteArray()
        assertRedactedByteKey(4, proxy, "zq9-proxy-bytes")
        assertRedactedByteKey(4, ByteBuffer.wrap(proxy), "zq9-proxy-buffer")
        assertRedactedByteKey(10, apiKey, "zq9-apikey-bytes")
        // A rule that rejects every key must not be shown a short prefix and then trusted.
        val closed = PayloadConverters(Limits(maxStringLength = 4), Redaction(keys = emptySet()))
        val seen = mutableListOf<String>()
        closed.redactWhen { key ->
            seen += key
            false
        }
        val snapshot = closed.snapshot(linkedMapOf(proxy to "zq9-closed-bytes")) as Map<*, *>
        assertEquals(REDACTED, snapshot.values.single(), snapshot.toString())
        assertTrue(seen.isEmpty(), seen.toString())
        assertNoLeak(snapshot, 4, "zq9-closed-bytes")
    }

    @Test
    fun `a byte key that is fully read is matched in full and still truncated for display`() {
        val token = snap(linkedMapOf("token".toByteArray() to "zq9-token-bytes"), 4) as Map<*, *>
        assertEquals(REDACTED, token.values.single(), token.toString())
        assertNoLeak(token, 4, "zq9-token-bytes")

        val plain = snap(linkedMapOf("plain".toByteArray() to "kept"), 4) as Map<*, *>
        assertEquals("kept", plain.values.single(), plain.toString())
        assertEquals(shortened("plain", 4), plain.keys.single())
    }

    @Test
    fun `a non-string key is read once and a failed read redacts the value`() {
        OnceName.reads.set(0)
        val snapshot = snap(linkedMapOf(OnceName() to "zq9-once-name"), 4) as Map<*, *>
        assertEquals(1, OnceName.reads.get())
        assertEquals(REDACTED, snapshot.values.single(), snapshot.toString())
        assertNoLeak(snapshot, 4, "zq9-once-name")

        var conversions = 0

        class TokenKey
        val payloads = PayloadConverters(Limits(maxStringLength = 4), Redaction())
        payloads.register(TokenKey::class.java) {
            conversions += 1
            if (conversions > 1) error("second conversion")
            "Proxy-Authorization"
        }
        val converted = payloads.snapshot(linkedMapOf(TokenKey() to "zq9-once-converter")) as Map<*, *>
        assertEquals(1, conversions)
        assertEquals(REDACTED, converted.values.single(), converted.toString())
        assertNoLeak(converted, 4, "zq9-once-converter")
    }

    @Test
    fun `a map or list used as a key is read once and a cap still redacts`() {
        val nested = snap(linkedMapOf(linkedMapOf("Authorization" to "zq9-inside-key", "note" to "hello") to "outer")) as Map<*, *>
        assertEquals("outer", nested.values.single(), nested.toString())
        assertFalse(nested.toString().contains("zq9-inside-key"), nested.toString())
        assertTrue(
            nested.keys
                .single()
                .toString()
                .contains(REDACTED),
            nested.toString(),
        )

        val cappedMap = snap(
            linkedMapOf(linkedMapOf("a" to "1", "b" to "2") to "zq9-map-items"),
            Limits(maxStringLength = 100, maxItems = 1),
        ) as Map<*, *>
        assertEquals(REDACTED, cappedMap.values.single(), cappedMap.toString())
        assertNoLeak(cappedMap, 100, "zq9-map-items")

        val asList = snap(linkedMapOf(listOf("alpha", "beta") to "list-value")) as Map<*, *>
        assertEquals("list-value", asList.values.single(), asList.toString())
        assertEquals("{[alpha, beta]=list-value}", asList.toString())

        val cappedList = snap(
            linkedMapOf(listOf("a", "b") to "zq9-list-items"),
            Limits(maxStringLength = 100, maxItems = 1),
        ) as Map<*, *>
        assertEquals(REDACTED, cappedList.values.single(), cappedList.toString())
        assertNoLeak(cappedList, 100, "zq9-list-items")

        val nestedName = snap(linkedMapOf(linkedMapOf(StringBuilder("note") to "inside") to "outer-note")) as Map<*, *>
        assertEquals("outer-note", nestedName.values.single(), nestedName.toString())
        assertTrue(nestedName.toString().contains("note=inside"), nestedName.toString())
    }

    @Test
    fun `a key that fails while it is read is redacted`() {
        val thrown = snap(linkedMapOf(FailingRecord("ann", "hidden") to "zq9-failing-record")) as Map<*, *>
        assertEquals(REDACTED, thrown.values.single(), thrown.toString())
        assertNoLeak(thrown, 100, "zq9-failing-record")

        val field = snap(linkedMapOf(FieldSecret("ann", "zq9-field-password") to "visible")) as Map<*, *>
        assertEquals("visible", field.values.single(), field.toString())
        assertFalse(field.toString().contains("zq9-field-password"), field.toString())
        assertTrue(field.toString().contains(REDACTED), field.toString())

        class Boom
        val payloads = PayloadConverters(Limits(), Redaction())
        payloads.register(Boom::class.java) { error("nope") }
        val converted = payloads.snapshot(linkedMapOf(Boom() to "zq9-boom-key")) as Map<*, *>
        assertEquals(REDACTED, converted.values.single(), converted.toString())
        assertNoLeak(converted, 100, "zq9-boom-key")

        val errorKey = snap(linkedMapOf(IllegalStateException("hello") to "kept-error")) as Map<*, *>
        assertEquals("kept-error", errorKey.values.single(), errorKey.toString())
        assertTrue(errorKey.toString().contains("hello"), errorKey.toString())
    }

    @Test
    fun `a key whose read runs out of budget is redacted without asking the rule`() {
        // The nested value's copy is what finds the budget already spent.
        assertClosed(
            linkedMapOf(linkedMapOf("abcdefghij" to "x") to "zq9-copy-budget"),
            Limits(maxStringLength = 10, maxTotalSize = 12),
            "zq9-copy-budget",
        )
        // The next map entry, list item or field is where the budget is noticed.
        val limits = Limits(maxStringLength = 100, maxTotalSize = 5)
        assertClosed(linkedMapOf(linkedMapOf("a" to "x", "b" to "y") to "zq9-map-budget"), limits, "zq9-map-budget")
        assertClosed(linkedMapOf(listOf("a", "b") to "zq9-list-budget"), Limits(maxStringLength = 100, maxTotalSize = 4), "zq9-list-budget")
        assertClosed(linkedMapOf(ItemKey("a", "b") to "zq9-field-budget"), Limits(maxStringLength = 100, maxTotalSize = 4), "zq9-field-budget")
    }

    @Test
    fun `a key whose toString throws on the first call is redacted without asking the rule`() {
        assertClosed(linkedMapOf(UnreadableKey() to "zq9-unreadable-key"), "zq9-unreadable-key")
    }

    @Test
    fun `a map key with an unreadable nested key is redacted without asking the rule`() {
        val seen = mutableListOf<String>()
        val payloads = PayloadConverters(Limits(), Redaction(keys = emptySet()))
        payloads.redactWhen { key ->
            seen += key
            false
        }
        val snapshot = payloads.snapshot(linkedMapOf(linkedMapOf(UnreadableKey() to "v") to "zq9-nested-unreadable")) as Map<*, *>
        assertEquals(REDACTED, snapshot.values.single(), snapshot.toString())
        assertTrue(seen.isEmpty(), seen.toString())
        assertNoLeak(snapshot, 100, "zq9-nested-unreadable")
    }

    @Test
    fun `a map key with a cut byte key inside it is redacted without asking the rule`() {
        val seen = mutableListOf<String>()
        val payloads = PayloadConverters(Limits(maxStringLength = 4), Redaction(keys = emptySet()))
        payloads.redactWhen { key ->
            seen += key
            false
        }
        val snapshot = payloads.snapshot(linkedMapOf(linkedMapOf("Proxy-Authorization".toByteArray() to "v") to "zq9-nested-bytes")) as Map<*, *>
        assertEquals(REDACTED, snapshot.values.single(), snapshot.toString())
        assertTrue(seen.isEmpty(), seen.toString())
        assertNoLeak(snapshot, 4, "zq9-nested-bytes")
    }

    @Test
    fun `a key that refers to itself is redacted without asking the rule`() {
        val cycle = mutableMapOf<String, Any?>()
        cycle["self"] = cycle
        val outer = IdentityHashMap<Any, Any>()
        outer[cycle] = "zq9-cycle-key"
        assertClosed(outer, "zq9-cycle-key")
    }

    @Test
    fun `a key hidden by the item or depth cap is redacted`() {
        val hiddenItems = snap(linkedMapOf(ItemKey("one", "two") to "zq9-hidden-items"), Limits(maxStringLength = 100, maxItems = 1)) as Map<*, *>
        assertEquals(REDACTED, hiddenItems.values.single(), hiddenItems.toString())
        assertNoLeak(hiddenItems, 100, "zq9-hidden-items")

        val hiddenDepth = snap(linkedMapOf(ItemKey("one", "two") to "zq9-hidden-depth"), Limits(maxStringLength = 100, maxDepth = 1)) as Map<*, *>
        assertEquals(REDACTED, hiddenDepth.values.single(), hiddenDepth.toString())
        assertNoLeak(hiddenDepth, 100, "zq9-hidden-depth")
    }

    @Test
    fun `a structured key is charged once, so the following value stops on the budget boundary`() {
        val note = "012345678901234"
        val shown = "0123456789… [lsd: truncated 5 characters]"
        val key = "{first=abcdefghij, second=klmnopqrst}"
        // 26 leaves nothing for "note". Resetting the budget after the key would keep it.
        assertEquals(
            mapOf(key to "v", PayloadConverters.TRUNCATED_KEY to "payload larger than 26 characters, rest dropped"),
            snap(linkedMapOf(ItemKey("abcdefghij", "klmnopqrst") to "v", "note" to note, "tail" to "z"), Limits(maxStringLength = 10, maxTotalSize = 26)),
        )
        // 31 keeps the shortened note and drops "tail". Charging the key twice would drop the note.
        assertEquals(
            mapOf(key to "v", "note" to shown, PayloadConverters.TRUNCATED_KEY to "payload larger than 31 characters, rest dropped"),
            snap(linkedMapOf(ItemKey("abcdefghij", "klmnopqrst") to "v", "note" to note, "tail" to "z"), Limits(maxStringLength = 10, maxTotalSize = 31)),
        )
        assertFalse(shown.contains(note))
    }

    @Test
    fun `a sensitive structured key is redacted without giving its budget back`() {
        val secret = "zq9-budget-secret"
        val note = "012345678901234"
        val payloads = PayloadConverters(Limits(maxStringLength = 10, maxTotalSize = 29), Redaction(keys = emptySet()))
        payloads.redactWhen { it.contains("Proxy-Authorization") }
        val snapshot =
            payloads.snapshot(
                linkedMapOf(
                    ItemKey("Proxy-Authorization", "klmnopqrst") to secret,
                    "note" to note,
                    "tail" to "z",
                ),
            )
        assertEquals(
            mapOf(
                "{first=Proxy-Auth… [lsd: truncated 9 characters], second=klmnopqrst}" to REDACTED,
                "note" to "0123456789… [lsd: truncated 5 characters]",
                PayloadConverters.TRUNCATED_KEY to "payload larger than 29 characters, rest dropped",
            ),
            snapshot,
        )
        assertNoLeak(snapshot, 10, secret)
    }

    @Test
    fun `the default string limit still redacts authorization`() {
        val secret = "zq9-default-authorization-value"
        val snapshot = snap(linkedMapOf("Authorization" to secret, "Content-Type" to "application/json"))
        assertEquals(mapOf("Authorization" to REDACTED, "Content-Type" to "application/json"), snapshot)
        assertFalse(snapshot.toString().contains(secret), snapshot.toString())
        assertTrue(Limits().maxStringLength >= "Authorization".length)
    }

    @Test
    fun `a written report does not contain a secret from a truncated map key`() {
        val auth = "zq9-report-authorization"
        val token = "zq9-report-token"
        val trace = "zq9-report-trace-label"
        val password = "zq9-report-password"
        val nestedAuth = "zq9-report-nested-auth"
        val secrets = listOf(auth, token, trace, password, nestedAuth)
        val note = "visible-note-012345678901234"

        val lsd = LsdContext()
        System.setProperty(LsdProperties.PAYLOAD_MAX_STRING_LENGTH, "10")
        lsd.clear()
        assertEquals(10, lsd.payloads.limits.maxStringLength)
        lsd.payloads.redactWhen { it == "X-Trace-Label" }
        lsd.beginScenario()
        lsd.accept(
            Interaction
                .builder(InteractionKind.REQUEST, "web", "api", "POST /login")
                .headers(
                    linkedMapOf(
                        "Authorization" to auth,
                        "token" to token,
                        "X-Trace-Label" to trace,
                        "Content-Type" to "application/json",
                    ),
                ).data(linkedMapOf("user" to "ann", "password" to password, "note" to note))
                .build(),
        )
        lsd.message(
            "web",
            "api",
            "nested",
            data =
                mapOf(
                    "headers" to linkedMapOf("Authorization" to nestedAuth, "Content-Type" to "application/json"),
                ),
        )
        lsd.completeScenario("truncated keys")
        val files = lsd.completeReport("Truncated key redaction")

        assertReport(ReportJson.read(files.reportJson), note)
        val written = tempDir.listDirectoryEntries()
        val names = written.map { it.name }
        assertTrue(names.any { it.endsWith("-report.json") }, names.toString())
        assertTrue(names.any { it.endsWith("-diagram.html") }, names.toString())
        assertTrue(names.any { it.endsWith("-payloads.js") }, names.toString())
        for (file in written.filter { Files.isRegularFile(it) }) {
            val text = file.readText()
            for (secret in secrets) {
                assertFalse(text.contains(secret), "${file.name} kept $secret")
            }
            // A shortened leak keeps this prefix of every synthetic value above.
            assertFalse(text.contains("zq9-report"), "${file.name} kept a shortened secret")
        }
    }

    private fun assertReport(report: ReportJson, note: String) {
        val scenario = report.scenario("truncated keys")
        val posted = scenario.message("POST /login").obj("data")!!
        val headers = posted.obj("headers")!!
        assertEquals(
            listOf(REDACTED, REDACTED, REDACTED, "applicatio… [lsd: truncated 6 characters]"),
            headers.values.toList(),
            headers.toString(),
        )
        val body = posted.obj("body")!!
        assertEquals("ann", body["user"])
        assertEquals(REDACTED, body["password"])
        assertEquals("visible-no… [lsd: truncated 18 characters]", body["note"])
        val nested = scenario.message("nested").obj("data")!!.obj("headers")!!
        assertEquals(listOf(REDACTED, "applicatio… [lsd: truncated 6 characters]"), nested.values.toList(), nested.toString())
        assertFalse(scenario.json.contains("zq9-report"), scenario.json)
        assertTrue(scenario.json.contains(shortened(note, 10)), scenario.json)
    }

    private fun snap(
        value: Any?,
        maxStringLength: Int,
        redaction: Redaction = Redaction(),
    ): Any? = snap(value, Limits(maxStringLength = maxStringLength), redaction)

    private fun snap(
        value: Any?,
        limits: Limits,
        redaction: Redaction = Redaction(),
    ): Any? = PayloadConverters(limits, redaction).snapshot(value)

    /** Built-in names off and every rule returns false, so only an incomplete key redacts. */
    private fun assertClosed(value: Any?, secret: String) {
        assertClosed(value, Limits(), secret)
    }

    private fun assertClosed(value: Any?, limits: Limits, secret: String) {
        val payloads = PayloadConverters(limits, Redaction(keys = emptySet()))
        payloads.redactWhen { false }
        val snapshot = payloads.snapshot(value) as Map<*, *>
        assertEquals(REDACTED, snapshot.values.single(), snapshot.toString())
        assertNoLeak(snapshot, limits.maxStringLength, secret)
    }

    private fun assertRedactedByteKey(limit: Int, key: Any, secret: String) {
        val snapshot = snap(linkedMapOf(key to secret), limit) as Map<*, *>
        assertEquals(REDACTED, snapshot.values.single(), "limit=$limit snapshot=$snapshot")
        assertNoLeak(snapshot, limit, secret)
    }

    /** The display string a string limit keeps, including the truncation suffix when the text is longer. */
    private fun shortened(value: String, limit: Int): String =
        if (value.length <= limit) {
            value
        } else {
            value.substring(0, limit) + "… [lsd: truncated ${value.length - limit} characters]"
        }

    private fun assertNoLeak(
        value: Any?,
        limit: Int,
        vararg secrets: String,
    ) {
        val text = value.toString()
        for (secret in secrets) {
            assertFalse(text.contains(secret), "limit $limit kept '$secret' in $text")
            // A shortened leak keeps the first `limit` characters. A one-character prefix is too
            // small to search for: it also occurs in ordinary keys such as Authorization.
            if (limit >= 3) {
                val prefix = secret.take(limit)
                assertFalse(text.contains(prefix), "limit $limit kept prefix '$prefix' of '$secret' in $text")
            }
        }
    }

    private companion object {
        val longSensitiveKeys =
            listOf(
                "Proxy-Authorization",
                "incoming-X-Api-Key",
                "vendor_api_key",
                "session-refresh_token",
                "oauth-client_secret",
                "browser-session-cookie",
                "response-set-cookie",
                "database_passwd",
                "account.password",
            )
    }
}
