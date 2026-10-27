package io.lsdconsulting.lsd.mono.ktor.fixture

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.server.application.Application
import io.ktor.server.application.install
import io.ktor.server.routing.routing
import io.ktor.server.websocket.WebSockets
import io.ktor.server.websocket.receiveDeserialized
import io.ktor.server.websocket.sendSerialized
import io.ktor.server.websocket.webSocket
import io.lsdconsulting.lsd.mono.ktor.Lsd
import kotlinx.coroutines.CompletableDeferred

/** A feed of live prices over a WebSocket. */
object LivePrices {
    /**
     * The prices app: each [Subscribe] gets that many [PriceChanged], after a stock check through
     * [stock] when there is one, until the client closes. [ended] completes once it has, so a test
     * can wait for the close to be drawn; [app] is null for a feed without the server plugin.
     */
    fun Application.prices(
        app: String? = "Prices",
        shown: Int = 20,
        stock: HttpClient? = null,
        ended: CompletableDeferred<Unit> = CompletableDeferred(),
    ) {
        install(WebSockets) { contentConverter = PriceMessages.converter }
        app?.let { name ->
            install(Lsd) {
                this.app = name
                messagesShown = shown
            }
        }
        routing {
            webSocket("/prices") {
                try {
                    val subscribe = receiveDeserialized<Subscribe>()
                    stock?.get("http://inventory/stock/${subscribe.sku}")
                    repeat(subscribe.ticks) { sendSerialized(PriceChanged(subscribe.sku, 4900 + it * 25)) }
                    for (frame in incoming) {
                        // Until the client closes.
                    }
                } finally {
                    ended.complete(Unit)
                }
            }
        }
    }
}
