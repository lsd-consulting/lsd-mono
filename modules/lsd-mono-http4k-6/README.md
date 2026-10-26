# lsd-mono-http4k-6

`lsd-mono-http4k-6` draws an [http4k](https://www.http4k.org) 6 app's HTTP calls and WebSockets on [lsd-mono-core](../lsd-mono-core)'s living sequence diagrams. It is three http4k filters and a WebSocket client wrapper, each one line of setup: a server filter for the requests the app serves, a client filter for the calls it makes, a WebSocket filter for the sockets it serves, and `wsClient` for the sockets it opens. They work the same whether the test calls the app in memory (an http4k `HttpHandler` is just a function) or over a real server and client. There is no PlantUML on this path.

## Depend on it

```kotlin
testImplementation("io.github.lsd-consulting:lsd-mono-http4k-6:<version>")
testImplementation("io.github.lsd-consulting:lsd-mono-junit-jupiter:<version>") // or lsd-mono-cucumber-8
```

The version is on the [Maven Central badge](../../README.md#getting-started) in the root README. From another project in this repo: `testImplementation(project(":modules:lsd-mono-http4k-6"))`.

http4k is not a dependency of this module (it is `compileOnly`): the app's own http4k 6 is used. The HTTP filters need only `http4k-core`; the WebSocket filter and client need `http4k-realtime-core`, which an app with WebSockets already has. http4k 6 needs Java 21, so this module is compiled for Java 21; the rest of lsd-mono stays on 17.

## Setup

Put the filters where the app is assembled, usually where the test builds it:

```kotlin
import io.lsdconsulting.lsd.mono.http4k.LsdHttp4k

// The requests Shop serves: Client → Shop: POST /orders, and the reply.
val shop: HttpHandler = LsdHttp4k.serverFilter("Shop").then(shopRoutes)

// The calls Shop makes: Shop → Inventory: GET /stock/lamp-01, and the reply.
val inventory: HttpHandler = LsdHttp4k.clientFilter("Inventory").then(JavaHttpClient())

// A WebSocket Prices serves: the handshake, each message either way, and the close.
val prices: WsHandler = LsdHttp4k.wsFilter("Prices").then(priceSockets)

// A WebSocket Shop opens to Prices: the same, drawn from Shop's end.
val feeds: WebsocketFactory = LsdHttp4k.wsClient(WebsocketClient(), "Prices")
val feed = feeds.blocking(Uri.of("ws://localhost:9000/prices"))

// Messages written through these lenses are labelled `Subscribe` and `PriceChanged`.
val subscribe = LsdHttp4k.labelled(WsMessage.auto<Subscribe>().toLens())
val priceChanged = LsdHttp4k.labelled(WsMessage.auto<PriceChanged>().toLens())
```

`serverFilter(app, client = "Client")` names the app and, for a request no filtered client made, the caller. `clientFilter(target, caller = "Client")` names the service called (left out, it is the host, or `host:port` for a local server, or `Downstream` for a request with no host); the caller is the app being served when the call is made while serving a request, and `caller` otherwise (a test calling the app). `wsFilter(app, client = "Client", messagesShown = 20)` draws the first `messagesShown` messages of a socket. `wsClient(factory, target, caller = "Client", messagesShown = 20)` wraps an http4k `WebsocketFactory` (`WebsocketClient()`, or `TestWebsocketFactory(wsHandler)` in a test) and names the other end as `clientFilter` does; use its `blocking` or `nonBlocking` as usual. The filters are plain http4k `Filter`s and `WsFilter`s, and the client a plain `WebsocketFactory`, so they compose with the app's own; all of them are `@JvmStatic` with default arguments for Java.

### Message labels

A WebSocket message's arrow has a short label, and its body is in the arrow's popup (folded if it is JSON). The label is `text message`, or `binary (3 bytes)`, unless the message was written through a lens wrapped in `LsdHttp4k.labelled(...)`: then it is the simple name of the class written, such as `PriceChanged`. Wrap the lenses the app writes with (`WsMessage.auto<T>().toLens()` or any `BiDiWsMessageLens`); reading through them is unchanged.

The name is remembered for the message's content, so it labels the arrow at whichever end in this JVM draws it: a test's client and the app's server, in memory or over a real socket. Limits:

- A message from outside this JVM, or written without a wrapped lens, keeps the default label: the label never comes from guessing at the JSON.
- JDK and Kotlin types (a `String`, a `List<PriceChanged>`) and anonymous classes keep the default label; wrap a class of the app's own.
- Two classes written as exactly the same bytes share the label of whichever was written last. Messages over 64 KiB are not named, and only the last 512 written are remembered.
- HTTP bodies are labelled as before (`POST /orders`); this is for WebSocket messages only.

## What a test looks like

```kotlin
@ExtendWith(LsdExtension::class)
class ShopTest {
    private val inventory = LsdHttp4k.serverFilter("Inventory").then(inventoryRoutes)
    private val shop = LsdHttp4k.serverFilter("Shop").then(
        shopRoutes(stock = LsdHttp4k.clientFilter("Inventory").then(inventory)),
    )

    @Test
    fun `an order for a lamp in stock is created`() {
        val response = shop(Request(POST, "/orders/lamp-01").body("""{"quantity":1}"""))
        assertEquals(CREATED, response.status)
    }
}
```

draws, in the test's scenario:

```text
Client    → Shop:      POST /orders/lamp-01
Shop      → Inventory: GET /stock/lamp-01
Inventory → Shop:      200 OK
Shop      → Client:    201 Created
```

The call to Inventory is drawn once, by Inventory's server filter under Inventory's name: a client filter whose call reaches a server filter in the same JVM leaves the drawing to it, in memory or over a socket. Without a server filter at the other end (a fake, or a real third party) the client filter draws the call itself.

## Sample report

[The sample report](https://lsd-consulting.github.io/lsd-mono/http4k-6/) is what this module's own fixtures draw: [the shop in memory](https://lsd-consulting.github.io/lsd-mono/http4k-6/shop-report.html), with a test that fails on purpose so the report shows an error scenario; [the same shop on real servers](https://lsd-consulting.github.io/lsd-mono/http4k-6/server-shop-report.html), called over sockets; and [a WebSocket of live prices](https://lsd-consulting.github.io/lsd-mono/http4k-6/live-prices-report.html), opened by a WebSocket client with its messages labelled `Subscribe` and `PriceChanged`, a busy socket capped, and the shop quoting a price through its own WebSocket client. The source is in [`fixture/`](https://github.com/lsd-consulting/lsd-mono/tree/main/modules/lsd-mono-http4k-6/src/test/kotlin/io/lsdconsulting/lsd/mono/http4k/fixture).

Build it yourself with `./gradlew :modules:lsd-mono-http4k-6:sampleReport` and open `modules/lsd-mono-http4k-6/build/pages/index.html`.

## What is drawn

- **Requests the app serves** (server filter): the request as `METHOD /path?query` with its headers and body, the reply as its status (`201 Created`) with headers, body and latency, and an exception the app throws as an error reply (`IllegalStateException`) before it is rethrown.
- **Calls the app makes** (client filter): the same, from the app being served to the target, nested under the request being served; a client exception is drawn as an error reply and rethrown.
- **Scenario propagation**: the client filter sends core's `lsd-scenario` header to the hosts `lsd.mono.propagation.allowedHosts` allows (by default only loopback), and the server filter reads it, so a request to a server on another thread lands in the right test even with several tests running. With no header, a server thread captures into the bound scenario, or the only one running (see [Threads and parallel tests](../lsd-mono-core/README.md#threads-and-parallel-tests)).
- **Bodies, without consuming them or holding them up**: an in-memory body is read without being consumed, and a stream with a `Content-Length` of up to 256 KiB is read and handed on intact (the app and the client still see every byte). A response stream of unknown length (chunked) is handed on at once and copied as the caller reads it: its reply is drawn when the caller has read it to the end or closed it (with the body if it came to no more than 256 KiB, else a note of its size; one closed before its end is marked `closed after N bytes, not read to the end`, with the bytes read if they came to no more than 256 KiB), and only those first 256 KiB are kept while it streams. A request stream of unknown length is handed to the app unread and drawn as a note (`a stream of unknown length, passed on unread`), since the request is drawn before the app reads it. A body over 256 KiB, a server-sent event stream and a compressed body (`Content-Encoding`, never decompressed or read: its encoding, and its size when known) are shown as a short note instead, and a stream of known length over the limit is never read at all. A body whose content type is `application/json` or `+json` is shown as a structure the inspector can fold, as the Spring Boot starter's are, read by a small built-in reader so the module needs no JSON library; so is a WebSocket text message that is a JSON object or array. Any other body is shown as text.
- **WebSockets** (WebSocket filter): the handshake as a call (`GET /prices`, `101 Switching Protocols`), each message as an arrow (labelled as in [Message labels](#message-labels), with the body in its popup; a text message over 256 KiB has its body noted as not shown), an error as an error arrow, and the close (`close 1000 Normal`) from whichever side closed. A busy socket draws its first `messagesShown` messages and a note of how many more it left out. Calls the app makes while handling a message (through a client filter) are drawn from the app, in the socket's scenario.
- **WebSockets the app opens** (`wsClient`): the same, from the app being served (else `caller`) to the target. The handshake carries the scenario like a client filter's calls, so a socket that reaches a WebSocket filter in this JVM is drawn there, once, under the server's name; otherwise the client draws it, including a failed handshake as an error reply.
- A filter applied twice, or a server filter behind a client filter in the same chain, draws once. LSD's own `lsd-*` headers are left off the diagram.

## Not covered (yet)

- **Thread hops inside the app**: a call the app makes on a thread or coroutine it starts itself is not nested under the request being served; it is drawn from the client filter's `caller`, in the bound or only running scenario. Carry the scenario with `LsdContext.instance.wrap(task)` or [lsd-mono-coroutines](../lsd-mono-coroutines).
- **Server-sent event contents**: an SSE reply is drawn as one reply noting the stream, not as its events, and http4k's `SseHandler`s are not filtered.
- **A close from the other end, on the blocking client**: http4k's blocking `WsClient` only ends its `received()` sequence, so that close is not drawn (unless the server's filter draws the socket). Its received messages are drawn as the app takes them from `received()`. The non-blocking client draws both.
- **Class names for messages read, not written, in this JVM**: a message from a service outside the test keeps the default label, even if the app reads it through a wrapped lens, since the arrow is drawn before the app reads it.
- **Request streams of unknown length** are not shown: the app gets them unread, and the report has a note in their place.
- **A streamed reply nobody reads**: a response stream of unknown length is drawn once it has been read to the end or closed. One the caller never reads or closes (which also leaks the connection) leaves the request drawn without its reply; one read after the scenario has finished is dropped, with a warning, like any capture after the scenario ends. To avoid it, keep the client in memory mode (`BodyMode.Memory`, `JavaHttpClient`'s default), so replies arrive with a known length and are drawn at once, or, if a test needs a streaming client, read or close every reply, for example with `response.body.stream.use { ... }` or `response.use { ... }`.
- **An unmatched WebSocket route** is still drawn as `101 Switching Protocols` followed by its close, because the filter sits in front of the router.
- No PlantUML, and nothing outside http4k's `Filter` and `WsFilter` (no Java agent, no global client interception): an http4k client or server without the filter is not drawn.

## Ideas from lsd-interceptors-http4k

[lsd-interceptors-http4k](https://github.com/lsd-consulting/lsd-interceptors-http4k) did this for the older lsd-core: one `Filter` in the app's chain that adds each request and response, headers and body, to the report. This module keeps that idea (an http4k filter, nothing else to install) and names the participants from the filters' arguments (or the URI's host) rather than the `User-Agent` and `Host` headers. It adds a filter for each direction with the dedupe between them, scenario propagation, stream-safe bodies and WebSockets, served and opened.

## Versions

http4k 6 only: the catalog holds the exact version (the `http4k-bom`), and the build fails if anything resolves to another http4k major. http4k 7 would be a separate `lsd-mono-http4k-7` module, as Cucumber 9 would be next to `lsd-mono-cucumber-8`.
