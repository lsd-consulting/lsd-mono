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
import java.nio.file.Files
import java.nio.file.Path
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

        val named = PayloadConverters(Limits(maxStringLength = limit), Redaction(keys = emptySet()))
        named.redact("traceid")
        val trace = named.snapshot(linkedMapOf("user-traceid" to "zq9-traceid-value")) as Map<*, *>
        assertEquals(REDACTED, trace.values.single(), trace.toString())
        assertNoLeak(trace, limit, "zq9-traceid-value")

        // A rule written against the truncation marker must not see that marker.
        val marker = PayloadConverters(Limits(maxStringLength = limit), Redaction(keys = emptySet()))
        marker.redactWhen { it.contains("… [lsd: truncated") }
        val kept = marker.snapshot(linkedMapOf("Content-Type" to "application/json")) as Map<*, *>
        assertEquals("applicatio… [lsd: truncated 6 characters]", kept.values.single())

        val failing = PayloadConverters(Limits(maxStringLength = limit), Redaction(keys = emptySet()))
        failing.redactWhen { error("broken rule") }
        assertEquals(REDACTED, (failing.snapshot(linkedMapOf("X-Trace-Label" to "zq9-thrown-value")) as Map<*, *>).values.single())
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
    fun `a non-string map key is matched before the truncation suffix is appended`() {
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

        // The second render used for matching must not spend the payload budget.
        val beside =
            PayloadConverters(Limits(maxStringLength = limit, maxTotalSize = 20), Redaction()).snapshot(
                linkedMapOf(
                    StringBuilder("Authorization") to secret,
                    "note" to "012345678901234",
                ),
            ) as Map<*, *>
        assertEquals(REDACTED, beside.values.first(), beside.toString())
        assertEquals("0123456789… [lsd: truncated 5 characters]", beside.values.last(), beside.toString())
        assertNoLeak(beside, limit, secret)

        val cutSeen = mutableListOf<String>()
        val cut = PayloadConverters(Limits(maxStringLength = limit), Redaction(keys = emptySet()))
        cut.redactWhen { key ->
            cutSeen += key
            key == "A".repeat(limit)
        }
        val cutSnapshot = cut.snapshot(linkedMapOf(ByteArray(50) { 'A'.code.toByte() } to "zq9-cut-bytes")) as Map<*, *>
        assertEquals(listOf("A".repeat(limit)), cutSeen)
        assertEquals(REDACTED, cutSnapshot.values.single(), cutSnapshot.toString())
        assertTrue(
            cutSnapshot.keys
                .single()
                .toString()
                .contains("bytes in total"),
            cutSnapshot.keys.toString(),
        )
        assertNoLeak(cutSnapshot, limit, "zq9-cut-bytes")

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
    ): Any? = PayloadConverters(Limits(maxStringLength = maxStringLength), redaction).snapshot(value)

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
