package io.github.lsdconsulting.lsd.mono.ktor.fixture

import io.github.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import io.github.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.inventory
import io.github.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.payments
import io.github.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.shop
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

/** The shop tested in memory, as most Ktor apps are: `testApplication`, no server, no port. */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class ShopFixture {
    private fun ApplicationTestBuilder.shopWith(paid: HttpStatusCode = HttpStatusCode.Accepted) {
        val outbound = client
        externalServices {
            hosts("http://inventory") { inventory() }
            hosts("http://payments") { payments(paid) }
        }
        application { shop(outbound) }
    }

    @Test
    fun `an order for a lamp in stock is paid and created`() =
        testApplication {
            shopWith()
            assertEquals(HttpStatusCode.Created, ShopApp.order(client, "lamp-01"))
        }

    @Test
    fun `an order for a desk out of stock is refused`() =
        testApplication {
            shopWith()
            assertEquals(HttpStatusCode.Conflict, ShopApp.order(client, "desk-02"))
        }

    /** Fails on purpose: the sample report shows a failed scenario with the reply that caused it. */
    @Test
    fun `an order is created even when payments are down`() =
        testApplication {
            shopWith(paid = HttpStatusCode.ServiceUnavailable)
            assertEquals(HttpStatusCode.Created, ShopApp.order(client, "lamp-01"))
        }
}
