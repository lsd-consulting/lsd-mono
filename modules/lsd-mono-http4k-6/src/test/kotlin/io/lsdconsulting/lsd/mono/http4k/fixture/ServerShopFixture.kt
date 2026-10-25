package io.lsdconsulting.lsd.mono.http4k.fixture

import io.lsdconsulting.lsd.mono.http4k.LsdHttp4k
import io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import org.http4k.client.JavaHttpClient
import org.http4k.core.Status.Companion.CREATED
import org.http4k.core.then
import org.http4k.server.Http4kServer
import org.http4k.server.SunHttp
import org.http4k.server.asServer
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.extension.ExtendWith

/** The shop and inventory on real servers, called over sockets: the same filters, the same diagram. */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ServerShopFixture {
    private lateinit var inventory: Http4kServer
    private lateinit var shop: Http4kServer

    @BeforeAll
    fun start() {
        inventory = ShopApp.inventory.asServer(SunHttp(0)).start()
        val inventoryClient = JavaHttpClient().let { client ->
            { request: org.http4k.core.Request ->
                client(
                    request.uri(
                        request.uri
                            .scheme("http")
                            .host("localhost")
                            .port(inventory.port()),
                    ),
                )
            }
        }
        shop = ShopApp.shop(inventory = inventoryClient).asServer(SunHttp(0)).start()
    }

    @AfterAll
    fun stop() {
        shop.stop()
        inventory.stop()
    }

    @Test
    fun `an order placed over HTTP is created`() {
        val client = LsdHttp4k.clientFilter("Shop").then(JavaHttpClient())
        val order = ShopApp.order("lamp-01")
        val response = client(
            order.uri(
                order.uri
                    .scheme("http")
                    .host("localhost")
                    .port(shop.port()),
            ),
        )
        assertEquals(CREATED, response.status)
    }
}
