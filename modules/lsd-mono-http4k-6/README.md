# lsd-mono-http4k-6

`lsd-mono-http4k-6` draws an [http4k](https://www.http4k.org) 6 app's HTTP calls and WebSockets on [lsd-mono-core](../lsd-mono-core)'s living sequence diagrams. It is three http4k filters, each one line of setup: a server filter for the requests the app serves, a client filter for the calls it makes, and a WebSocket filter. They work the same whether the test calls the app in memory (an http4k `HttpHandler` is just a function) or over a real server and client. There is no PlantUML on this path.

## Depend on it

```kotlin
testImplementation("io.github.lsd-consulting:lsd-mono-http4k-6:<version>")
testImplementation("io.github.lsd-consulting:lsd-mono-junit-jupiter:<version>") // or lsd-mono-cucumber-8
```

The version is on the [Maven Central badge](../../README.md#getting-started) in the root README. From another project in this repo: `testImplementation(project(":modules:lsd-mono-http4k-6"))`.

http4k is not a dependency of this module (it is `compileOnly`): the app's own http4k 6 is used. The HTTP filters need only `http4k-core`; the WebSocket filter needs `http4k-realtime-core`, which an app with WebSockets already has. http4k 6 needs Java 21, so this module is compiled for Java 21; the rest of lsd-mono stays on 17.

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
```

`serverFilter(app, client = "Client")` names the app and, for a request no filtered client made, the caller. `clientFilter(target, caller = "Client")` names the service called (left out, it is the host, or `host:port` for a local server, or `Downstream` for a request with no host); the caller is the app being served when the call is made while serving a request, and `caller` otherwise (a test calling the app). `wsFilter(app, client = "Client", messagesShown = 20)` draws the first `messagesShown` messages of a socket. The filters are plain http4k `Filter`s and `WsFilter`s, so they compose with the app's own; all of them are `@JvmStatic` with default arguments for Java.

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

[The sample report](https://lsd-consulting.github.io/lsd-mono/http4k-6/) is what this module's own fixtures draw: [the shop in memory](https://lsd-consulting.github.io/lsd-mono/http4k-6/shop-report.html), with a test that fails on purpose so the report shows an error scenario; [the same shop on real servers](https://lsd-consulting.github.io/lsd-mono/http4k-6/server-shop-report.html), called over sockets; and [a WebSocket of live prices](https://lsd-consulting.github.io/lsd-mono/http4k-6/live-prices-report.html), with a busy socket capped. The source is in [`fixture/`](https://github.com/lsd-consulting/lsd-mono/tree/main/modules/lsd-mono-http4k-6/src/test/kotlin/io/lsdconsulting/lsd/mono/http4k/fixture).

Build it yourself with `./gradlew :modules:lsd-mono-http4k-6:sampleReport` and open `modules/lsd-mono-http4k-6/build/pages/index.html`.

## What is drawn

- **Requests the app serves** (server filter): the request as `METHOD /path?query` with its headers and body, the reply as its status (`201 Created`) with headers, body and latency, and an exception the app throws as an error reply (`IllegalStateException`) before it is rethrown.
- **Calls the app makes** (client filter): the same, from the app being served to the target, nested under the request being served; a client exception is drawn as an error reply and rethrown.
- **Scenario propagation**: the client filter sends core's `lsd-scenario` header to the hosts `lsd.mono.propagation.allowedHosts` allows (by default only loopback), and the server filter reads it, so a request to a server on another thread lands in the right test even with several tests running. With no header, a server thread captures into the bound scenario, or the only one running (see [Threads and parallel tests](../lsd-mono-core/README.md#threads-and-parallel-tests)).
- **Bodies, without consuming them**: an in-memory body is read without being consumed; a stream is read up to 256 KiB and handed on intact (the app and the client still see every byte). A body over 256 KiB, a compressed body (`Content-Encoding`) and a server-sent event stream are shown as a short note (`larger than 256 KiB`, the encoding and size, the stream's content type) instead, and a stream of known length over the limit is never read at all. A JSON object or array (in an HTTP body or a WebSocket text message) is shown as a structure the inspector can fold, as the Spring Boot starter's are, read by a small built-in reader so the module needs no JSON library; any other body is shown as text.
- **WebSockets** (WebSocket filter): the handshake as a call (`GET /prices`, `101 Switching Protocols`), each message as an arrow (a text message is labelled with its first line, up to 40 characters; a binary one as `binary (3 bytes)`), an error as an error arrow, and the close (`close 1000 Normal`) from whichever side closed. A busy socket draws its first `messagesShown` messages and a note of how many more it left out. Calls the app makes while handling a message (through a client filter) are drawn from the app, in the socket's scenario.
- A filter applied twice, or a server filter behind a client filter in the same chain, draws once. LSD's own `lsd-*` headers are left off the diagram.

## Not covered (yet)

- **Thread hops inside the app**: a call the app makes on a thread or coroutine it starts itself is not nested under the request being served; it is drawn from the client filter's `caller`, in the bound or only running scenario. Carry the scenario with `LsdContext.instance.wrap(task)` or [lsd-mono-coroutines](../lsd-mono-coroutines).
- **Server-sent event contents**: an SSE reply is drawn as one reply noting the stream, not as its events, and http4k's `SseHandler`s are not filtered.
- **WebSocket clients**: the WebSocket filter is server-side; an http4k `WebsocketClient` the app uses to call out is not drawn.
- **Request streams of unknown length** are read up to 256 KiB before the app sees them, so a streaming upload with no `Content-Length` is held until that much has arrived.
- **An unmatched WebSocket route** is still drawn as `101 Switching Protocols` followed by its close, because the filter sits in front of the router.
- No PlantUML, and nothing outside http4k's `Filter` and `WsFilter` (no Java agent, no global client interception): an http4k client or server without the filter is not drawn.

## Ideas from lsd-interceptors-http4k

[lsd-interceptors-http4k](https://github.com/lsd-consulting/lsd-interceptors-http4k) did this for the older lsd-core: one `Filter` in the app's chain that adds each request and response, headers and body, to the report. This module keeps that idea (an http4k filter, nothing else to install) and names the participants from the filters' arguments (or the URI's host) rather than the `User-Agent` and `Host` headers. It adds a filter for each direction with the dedupe between them, scenario propagation, stream-safe bodies and WebSockets.

## Versions

http4k 6 only: the catalog holds the exact version (the `http4k-bom`), and the build fails if anything resolves to another http4k major. http4k 7 would be a separate `lsd-mono-http4k-7` module, as Cucumber 9 would be next to `lsd-mono-cucumber-8`.
