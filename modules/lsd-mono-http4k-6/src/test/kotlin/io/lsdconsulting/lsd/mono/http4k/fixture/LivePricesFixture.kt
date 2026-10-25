package io.lsdconsulting.lsd.mono.http4k.fixture

import io.lsdconsulting.lsd.mono.http4k.LsdHttp4k
import io.lsdconsulting.lsd.mono.junitjupiter.LsdExtension
import org.http4k.core.Method.GET
import org.http4k.core.Request
import org.http4k.core.then
import org.http4k.routing.bindWs
import org.http4k.routing.websockets
import org.http4k.testing.testWsClient
import org.http4k.websocket.Websocket
import org.http4k.websocket.WsMessage
import org.http4k.websocket.WsResponse
import org.http4k.websocket.WsStatus
import org.http4k.websocket.then
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

/** A WebSocket of live prices: the handshake, the messages either way, and a chatty one capped. */
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
                            val (sku, ticks) = message.bodyString().split(" ").let { it[0] to (it.getOrNull(1)?.toInt() ?: 2) }
                            stock(Request(GET, "/stock/$sku"))
                            repeat(ticks) { ws.send(WsMessage("""{"sku":"$sku","pence":${4900 + it * 25}}""")) }
                        }
                    }
                },
            ),
        )

    @Test
    fun `a client subscribes to a lamp's price and gets each change`() {
        val client = prices.testWsClient(Request(GET, "/prices"))
        client.send(WsMessage("lamp-01"))
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
        val client = prices.testWsClient(Request(GET, "/prices"))
        client.send(WsMessage("lamp-01 40"))
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
}
