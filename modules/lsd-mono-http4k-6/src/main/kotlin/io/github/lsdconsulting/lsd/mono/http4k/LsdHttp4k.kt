package io.github.lsdconsulting.lsd.mono.http4k

import org.http4k.core.Filter
import org.http4k.lens.BiDiWsMessageLens
import org.http4k.websocket.WebsocketFactory
import org.http4k.websocket.WsFilter

/**
 * Draws an http4k app's HTTP calls and WebSockets on the LSD diagram of the test that makes them.
 *
 * ```
 * val app = LsdHttp4k.serverFilter("Orders").then(routes)          // what the app serves
 * val payments = LsdHttp4k.clientFilter("Payments").then(client)  // what the app calls
 * val sockets = LsdHttp4k.wsFilter("Orders").then(wsRoutes)        // the WebSockets it serves
 * val prices = LsdHttp4k.wsClient(WebsocketClient(), "Prices")     // the WebSockets it opens
 * val priceChanged = LsdHttp4k.labelled(WsMessage.auto<PriceChanged>().toLens()) // arrows say PriceChanged
 * ```
 *
 * Each filter draws into the scenario the call belongs to and passes everything through
 * untouched when there is none (outside a test, or a test without LSD). Capture never breaks the
 * app: a failure to capture leaves the event out, with one warning.
 */
public object LsdHttp4k {
    /** Who a call comes from when nothing says: a test calling the app. */
    public const val DEFAULT_CLIENT: String = "Client"

    /** Who a server filter serves as when not named. */
    public const val DEFAULT_APP: String = "App"

    /** How many messages each WebSocket draws before it only counts them. */
    public const val DEFAULT_MESSAGES_SHOWN: Int = 20

    /**
     * Draws each request the app serves, from its caller (another app's [clientFilter], else
     * [client]) to [app], with the reply or the exception the app threw.
     */
    @JvmStatic
    @JvmOverloads
    public fun serverFilter(
        app: String = DEFAULT_APP,
        client: String = DEFAULT_CLIENT,
    ): Filter = ServerFilter(app, client)

    /**
     * Draws each call made through it, from the app serving the current request (else [caller])
     * to [target] (else the host: `localhost:8081` for a loopback one), and carries the scenario
     * to hosts allowed by `lsd.mono.propagation.allowedHosts` (loopback by default). A call that
     * reaches a [serverFilter] in this JVM is drawn there, under the name the server gives itself.
     */
    @JvmStatic
    @JvmOverloads
    public fun clientFilter(
        target: String? = null,
        caller: String = DEFAULT_CLIENT,
    ): Filter = ClientFilter(target, caller)

    /**
     * Draws each WebSocket the app serves: the handshake as a call from [client] to [app], then
     * the first [messagesShown] messages either way as arrows, the close and any error. Needs
     * `org.http4k:http4k-realtime-core`, which every http4k WebSocket app already has.
     */
    @JvmStatic
    @JvmOverloads
    public fun wsFilter(
        app: String = DEFAULT_APP,
        client: String = DEFAULT_CLIENT,
        messagesShown: Int = DEFAULT_MESSAGES_SHOWN,
    ): WsFilter {
        require(messagesShown >= 0) { "messagesShown must not be negative" }
        return WsCapture(app, client, messagesShown)
    }

    /**
     * Draws each WebSocket opened through [factory] (`WebsocketClient()`, or http4k's
     * `TestWebsocketFactory` in a test): the handshake as a call from the app serving the current
     * request (else [caller]) to [target] (else the host, as for [clientFilter]), the first
     * [messagesShown] messages it sends and receives, the close and any error. The handshake
     * carries the scenario as [clientFilter]'s calls do, so a socket that reaches a [wsFilter] in
     * this JVM is drawn there, once. Needs `org.http4k:http4k-realtime-core`.
     */
    @JvmStatic
    @JvmOverloads
    public fun wsClient(
        factory: WebsocketFactory,
        target: String? = null,
        caller: String = DEFAULT_CLIENT,
        messagesShown: Int = DEFAULT_MESSAGES_SHOWN,
    ): WebsocketFactory {
        require(messagesShown >= 0) { "messagesShown must not be negative" }
        return WsClientCapture(factory, target, caller, messagesShown)
    }

    /**
     * The same lens, but a message it writes is labelled on the diagram with the simple name of
     * the value's class (`PriceChanged`) rather than `text message`, at whichever end in this JVM
     * draws it. Reading through it is unchanged. Values of JDK and Kotlin classes (a `String`, a
     * `List`) and anonymous classes keep the default label.
     */
    @JvmStatic
    public fun <T> labelled(lens: BiDiWsMessageLens<T>): BiDiWsMessageLens<T> =
        BiDiWsMessageLens(
            { message -> lens.extract(message) },
            { value, _ -> lens.create(value).also { MessageNames.record(it, value) } },
        )
}
