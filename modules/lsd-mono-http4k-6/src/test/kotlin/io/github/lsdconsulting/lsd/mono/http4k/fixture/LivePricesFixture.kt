package io.github.lsdconsulting.lsd.mono.http4k.fixture

import io.github.lsdconsulting.lsd.mono.http4k.LsdHttp4k
import io.github.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import org.http4k.core.Method.GET
import org.http4k.core.Request
import org.http4k.core.Response
import org.http4k.core.Status.Companion.OK
import org.http4k.core.then
import org.http4k.routing.bind
import org.http4k.routing.bindWs
import org.http4k.routing.path
import org.http4k.routing.routes
import org.http4k.routing.websockets
import org.http4k.testing.TestWebsocketFactory
import org.http4k.websocket.Websocket
import org.http4k.websocket.WsResponse
import org.http4k.websocket.WsStatus
import org.http4k.websocket.blocking
import org.http4k.websocket.then
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

/**
 * A WebSocket of live prices: the handshake, the messages either way labelled with their classes,
 * a chatty one capped, and a shop that opens the socket itself through a WebSocket client.
 */
@Tag("lsd-fixture")
@ExtendWith(LsdExtension::class)
class LivePricesFixture {
    private val stock = LsdHttp4k.clientFilter("Inventory").then(ShopApp.inventory)

    private val prices =
        LsdHttp4k.wsFilter("Prices", messagesShown = 6).then(
            websockets(
                "/prices" bindWs { _: Request ->
                    WsResponse { ws: Websocket ->
                        ws.onMessage { message ->
                            val subscribe = PriceMessages.subscribe(message)
                            stock(Request(GET, "/stock/${subscribe.sku}"))
                            repeat(subscribe.ticks) {
                                ws.send(PriceMessages.priceChanged(PriceChanged(subscribe.sku, 4900 + it * 25)))
                            }
                        }
                    }
                },
            ),
        )

    /** The WebSockets a test, or the shop, opens: in memory, to the prices app. */
    private val sockets = TestWebsocketFactory(prices)

    @Test
    fun `a client subscribes to a lamp's price and gets each change`() {
        val client = LsdHttp4k.wsClient(sockets).blocking("/prices")
        client.send(PriceMessages.subscribe(Subscribe("lamp-01")))
        assertEquals(
            2,
            client
                .received()
                .take(2)
                .toList()
                .size,
        )
        client.close(WsStatus.NORMAL)
    }

    @Test
    fun `a busy feed draws its first messages and counts the rest`() {
        val client = LsdHttp4k.wsClient(sockets).blocking("/prices")
        client.send(PriceMessages.subscribe(Subscribe("lamp-01", ticks = 40)))
        assertEquals(
            40,
            client
                .received()
                .take(40)
                .toList()
                .size,
        )
        client.close(WsStatus.NORMAL)
    }

    @Test
    fun `the shop quotes a price from the live feed through its own WebSocket client`() {
        val shop =
            LsdHttp4k.serverFilter("Shop").then(
                routes(
                    "/quote/{sku}" bind GET to { request ->
                        val feed = LsdHttp4k.wsClient(sockets).blocking("/prices")
                        feed.send(PriceMessages.subscribe(Subscribe(request.path("sku")!!, ticks = 1)))
                        val price = PriceMessages.priceChanged(feed.received().first())
                        feed.close(WsStatus.NORMAL)
                        Response(OK).body("""{"sku":"${price.sku}","pence":${price.pence}}""")
                    },
                ),
            )
        assertEquals(OK, shop(Request(GET, "/quote/desk-02")).status)
    }
}
