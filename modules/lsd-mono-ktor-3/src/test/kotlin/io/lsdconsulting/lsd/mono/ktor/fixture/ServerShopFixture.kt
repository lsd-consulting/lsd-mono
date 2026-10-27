package io.lsdconsulting.lsd.mono.ktor.fixture

import io.ktor.client.HttpClient
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.Application
import io.ktor.server.engine.EmbeddedServer
import io.ktor.server.engine.embeddedServer
import io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import io.lsdconsulting.lsd.mono.ktor.LsdClient
import io.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.inventory
import io.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.payments
import io.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.shop
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestInstance
import org.junit.jupiter.api.extension.ExtendWith
import io.ktor.client.engine.cio.CIO as ClientCIO
import io.ktor.server.cio.CIO as ServerCIO

/** The shop, inventory and payments on real servers, called over sockets: the same plugins, the same diagram. */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ServerShopFixture {
    private val servers = mutableListOf<EmbeddedServer<*, *>>()
    private val client = HttpClient(ClientCIO)
    private var shopPort = 0

    private fun serve(module: Application.() -> Unit): Int {
        val server = embeddedServer(ServerCIO, port = 0, module = module).start(wait = false)
        servers += server
        return runBlocking {
            server.engine
                .resolvedConnectors()
                .first()
                .port
        }
    }

    @BeforeAll
    fun start() {
        val inventoryPort = serve { inventory() }
        val paymentsPort = serve { payments() }
        shopPort = serve { shop(client, "http://localhost:$inventoryPort", "http://localhost:$paymentsPort") }
    }

    @AfterAll
    fun stop() {
        servers.forEach { it.stop(0, 0) }
        client.close()
    }

    @Test
    fun `an order placed over HTTP is created`() {
        val caller = client.config { install(LsdClient) { target = "Shop" } }
        assertEquals(HttpStatusCode.Created, runBlocking { ShopApp.order(caller, "lamp-01", "http://localhost:$shopPort") })
    }
}
