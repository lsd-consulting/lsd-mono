package io.github.lsdconsulting.lsd.mono.springboot

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import java.net.URI

class ParticipantNamesTest {
    private fun env(vararg props: Pair<String, Any>) =
        StandardEnvironment().apply { propertySources.addFirst(MapPropertySource("test", mapOf(*props))) }

    @Test
    fun `names a service after the property holding its URL`() {
        val names =
            ParticipantNames(
                env(
                    "shop.payments.base-url" to "http://localhost:58231",
                    "clients.card-network.url" to "https://cards.example.com/v2",
                    "spring.application.name" to "orders-service",
                ),
            )

        assertEquals("Orders service", names.app)
        assertEquals("Client", names.client)
        assertEquals("Payments", names.of(URI("http://localhost:58231/charges")))
        assertEquals("Card network", names.of(URI("https://cards.example.com/v2/auth")))
        assertEquals("localhost:9999", names.of(URI("http://localhost:9999/x")))
        assertEquals("api.other.com", names.of(URI("https://api.other.com/x")))
    }

    @Test
    fun `a URL with no port is the scheme's default - 443 for https and wss, else 80`() {
        val names = ParticipantNames(env("shop.quotes.url" to "wss://quotes.example.com/stream", "shop.feed.url" to "ws://feed.example.com/ticks"))

        assertEquals("Quotes", names.of(URI("wss://quotes.example.com:443/stream")))
        assertEquals("quotes.example.com", names.of(URI("wss://quotes.example.com:80/stream")))
        assertEquals("Feed", names.of(URI("ws://feed.example.com:80/ticks")))
    }

    @Test
    fun `overrides and own port`() {
        val names = ParticipantNames(env("lsd.mono.spring.app-name" to "Shop", "lsd.mono.spring.client-name" to "Tester", "local.server.port" to "8081"))

        assertEquals("Shop", names.app)
        assertEquals("Tester", names.client)
        assertTrue(names.isSelf(URI("http://127.0.0.1:8081/orders")))
        assertFalse(names.isSelf(URI("http://localhost:8082/orders")))
    }

    @Test
    fun `name from a property key`() {
        assertEquals("Inventory", ParticipantNames.nameFromKey("shop.inventory.url"))
        assertEquals("Pricing engine", ParticipantNames.nameFromKey("pricingEngine.endpoint"))
        assertEquals("Fx", ParticipantNames.nameFromKey("services[fx].base-uri"))
        assertNull(ParticipantNames.nameFromKey("http.client.url"))
    }
}
