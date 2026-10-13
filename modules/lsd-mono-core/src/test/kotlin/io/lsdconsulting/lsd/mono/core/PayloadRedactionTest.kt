package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.PayloadConverters.Companion.REDACTED
import io.lsdconsulting.lsd.mono.core.PayloadConverters.Limits
import io.lsdconsulting.lsd.mono.core.PayloadConverters.Redaction
import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path

/** Secrets in message data are written as `[lsd: redacted]` (#43). */
class PayloadRedactionTest {
    @TempDir
    lateinit var tempDir: Path

    @AfterEach
    fun clearProperties() {
        System.clearProperty(LsdProperties.PAYLOAD_REDACT)
        System.clearProperty(LsdProperties.PAYLOAD_REDACT_KEYS)
        System.clearProperty(LsdProperties.OUTPUT_DIR)
    }

    private val converters = PayloadConverters(Limits(), Redaction())

    private fun snap(value: Any?): Any? = converters.snapshot(value)

    data class Login(val user: String, val password: String, val apiKey: String?, val profile: Profile)

    data class Profile(val name: String, val sessionToken: String)

    @JvmRecord
    data class Card(val number: String, val secret: String)

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

        System.setProperty(LsdProperties.PAYLOAD_REDACT, "no") // anything but false keeps them on
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
}
