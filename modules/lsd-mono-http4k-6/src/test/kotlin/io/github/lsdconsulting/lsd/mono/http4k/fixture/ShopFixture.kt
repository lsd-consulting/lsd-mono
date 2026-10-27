package io.github.lsdconsulting.lsd.mono.http4k.fixture

import io.github.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import org.http4k.core.Status.Companion.CONFLICT
import org.http4k.core.Status.Companion.CREATED
import org.http4k.core.Status.Companion.SERVICE_UNAVAILABLE
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

/** The shop tested in memory, as most http4k apps are: no server, no port. */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class ShopFixture {
    @Test
    fun `an order for a lamp in stock is paid and created`() {
        val response = ShopApp.shop()(ShopApp.order("lamp-01"))
        assertEquals(CREATED, response.status)
    }

    @Test
    fun `an order for a desk out of stock is refused`() {
        val response = ShopApp.shop()(ShopApp.order("desk-02"))
        assertEquals(CONFLICT, response.status)
    }

    /** Fails on purpose: the sample report shows a failed scenario with the reply that caused it. */
    @Test
    fun `an order is created even when payments are down`() {
        val response = ShopApp.shop(payments = ShopApp.payments(SERVICE_UNAVAILABLE))(ShopApp.order("lamp-01"))
        assertEquals(CREATED, response.status)
    }
}
