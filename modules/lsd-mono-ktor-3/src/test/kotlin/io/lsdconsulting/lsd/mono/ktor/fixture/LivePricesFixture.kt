package io.lsdconsulting.lsd.mono.ktor.fixture

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.receiveDeserialized
import io.ktor.client.plugins.websocket.sendSerialized
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.install
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import io.ktor.websocket.CloseReason
import io.ktor.websocket.close
import io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import io.lsdconsulting.lsd.mono.ktor.Lsd
import io.lsdconsulting.lsd.mono.ktor.LsdClient
import io.lsdconsulting.lsd.mono.ktor.fixture.LivePrices.prices
import io.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.inventory
import io.lsdconsulting.lsd.mono.ktor.fixture.ShopApp.to
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import io.ktor.client.plugins.websocket.WebSockets as ClientWebSockets

/**
 * A WebSocket of live prices: the handshake, the messages either way labelled with their classes,
 * a chatty one capped, and a shop that opens the socket itself through a WebSocket client.
 */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class LivePricesFixture {
    private val ended = CompletableDeferred<Unit>()

    /** The prices app at `ws://prices`, checking stock with inventory, and a client with the price messages. */
    private fun ApplicationTestBuilder.feed(): HttpClient {
        val stock = client.to("Inventory")
        externalServices {
            hosts("http://inventory") { inventory() }
            hosts("ws://prices") { prices(shown = 6, stock = stock, ended = ended) }
        }
        return createClient { install(ClientWebSockets) { contentConverter = PriceMessages.converter } }
    }

    /** Waits until the prices app has seen the close, so the report has it. */
    private suspend fun closed() = withTimeout(5_000) { ended.await() }

    @Test
    fun `a client subscribes to a lamp's price and gets each change`() =
        testApplication {
            feed().webSocket("ws://prices/prices") {
                sendSerialized(Subscribe("lamp-01"))
                repeat(2) { receiveDeserialized<PriceChanged>() }
                close(CloseReason(CloseReason.Codes.NORMAL, "done"))
            }
            closed()
        }

    @Test
    fun `a busy feed draws its first messages and counts the rest`() =
        testApplication {
            feed().webSocket("ws://prices/prices") {
                sendSerialized(Subscribe("lamp-01", ticks = 40))
                repeat(40) { receiveDeserialized<PriceChanged>() }
                close(CloseReason(CloseReason.Codes.NORMAL, "done"))
            }
            closed()
        }

    @Test
    fun `the shop quotes a price from the live feed through its own WebSocket client`() =
        testApplication {
            val sockets =
                feed().config {
                    install(LsdClient) {
                        caller = "Shop"
                        target = "Prices"
                    }
                }
            application {
                install(Lsd) { app = "Shop" }
                routing {
                    get("/quote/{sku}") {
                        val sku = call.parameters["sku"].orEmpty()
                        var quote: PriceChanged? = null
                        sockets.webSocket("ws://prices/prices") {
                            sendSerialized(Subscribe(sku, ticks = 1))
                            quote = receiveDeserialized<PriceChanged>()
                            close(CloseReason(CloseReason.Codes.NORMAL, "done"))
                        }
                        call.respondText("""{"sku":"${quote?.sku}","pence":${quote?.pence}}""")
                    }
                }
            }
            assertEquals(HttpStatusCode.OK, client.get("/quote/desk-02").status)
            closed()
        }
}
