package io.lsdconsulting.lsd.mono.ktor

import io.ktor.http.HttpHeaders
import io.ktor.http.content.OutgoingContent
import io.ktor.server.websocket.WebSocketUpgrade
import kotlinx.coroutines.withContext

/**
 * The WebSockets an app serves, drawn from the server's end. Loaded only for a
 * [WebSocketUpgrade], so an app without Ktor's WebSockets plugin never needs it.
 */
internal object ServerSockets {
    /**
     * [content] as it was, with the session its handler gets drawn: each message, the close and
     * an error, in the scenario of the handshake. While the handler runs the scenario is bound
     * to it, and the app's own calls nest under the last message in (else the handshake).
     */
    fun tap(
        content: OutgoingContent,
        inbound: ServerCapture.Inbound,
        app: String,
        shown: Int,
    ): OutgoingContent {
        val upgrade = content as WebSocketUpgrade
        // The same extensions as the original negotiated: none unless it sent the header.
        val extensions = upgrade.headers[HttpHeaders.SecWebSocketExtensions] != null
        return WebSocketUpgrade(upgrade.call, upgrade.protocol, extensions) {
            val raw = this
            val tap = WsTap(WsDrawing(inbound.scenario, app, shown), app, inbound.caller)
            val serving = Serving(inbound.scenario, app) { tap.lastIn ?: inbound.id }
            withContext(ServingElement(serving)) {
                try {
                    upgrade.handle(tap.wrap(raw))
                } catch (e: Throwable) {
                    tap.failed(e)
                    throw e
                } finally {
                    tap.ended(null)
                }
            }
        }
    }
}
