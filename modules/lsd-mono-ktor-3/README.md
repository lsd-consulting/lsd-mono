# lsd-mono-ktor-3

`lsd-mono-ktor-3` draws a [Ktor](https://ktor.io) 3 app's HTTP calls and WebSockets on [lsd-mono-core](../lsd-mono-core)'s living sequence diagrams. It is two Ktor plugins, each one line of setup: `Lsd`, a server plugin for the requests and WebSockets the app serves, and `LsdClient`, an `HttpClient` plugin for the calls and WebSockets the app makes. They work the same in `testApplication` (in memory) and on real engines such as CIO or Netty. There is no PlantUML on this path.

## Depend on it

```kotlin
testImplementation("io.github.lsd-consulting:lsd-mono-ktor-3:<version>")
testImplementation("io.github.lsd-consulting:lsd-mono-junit-jupiter:<version>") // or lsd-mono-cucumber-8
```

The version is on the [Maven Central badge](../../README.md#jvm-kotlin-java) in the root README. This module is not on Maven Central yet: it is first published with the next weekly release, and so is its [sample report](https://lsd-consulting.github.io/lsd-mono/ktor-3/). From another project in this repo: `testImplementation(project(":modules:lsd-mono-ktor-3"))`.

Ktor is not a dependency of this module (it is `compileOnly`): the app's own Ktor 3 is used. The server plugin needs `ktor-server-core` and the client plugin `ktor-client-core`; WebSockets served need `ktor-server-websockets`, which an app with WebSockets already has (the client's are in `ktor-client-core`). The module runs on the same Java as the rest of lsd-mono (17 or later).

## Setup

Install the plugins where the app and its clients are built, usually where the test builds them:

```kotlin
import io.lsdconsulting.lsd.mono.ktor.Lsd
import io.lsdconsulting.lsd.mono.ktor.LsdClient
import io.lsdconsulting.lsd.mono.ktor.LsdKtor

// The requests and WebSockets Shop serves: Client → Shop: POST /orders, and the reply.
fun Application.shop() {
    install(Lsd) { app = "Shop" }
    // ...routing as usual
}

// The calls Shop makes: Shop → Inventory: GET /stock/lamp-01, and the reply.
val inventory = HttpClient(CIO) { install(LsdClient) { target = "Inventory" } }

// WebSocket messages written through this converter are labelled `Subscribe` and `PriceChanged`.
install(WebSockets) { contentConverter = LsdKtor.labelled(KotlinxWebsocketSerializationConverter(Json)) }
```

`install(Lsd) { app; client = "Client"; messagesShown = 20 }` names the app, the caller of a request no client plugin in this JVM made (a test, say), and how many messages each WebSocket draws. `install(LsdClient) { target; caller = "Client"; messagesShown = 20 }` names the service called (left out, it is the host, or `host:port` for a local server); the caller is the app being served when the call is made while serving a request, and `caller` otherwise. In `testApplication`, install `LsdClient` on a client from `createClient { }`, or `client.config { }`. Installation order does not matter: `Lsd` runs before every other plugin's phase, StatusPages included. Nor does it on the client: with `HttpRequestRetry`, `HttpRedirect` or `HttpTimeout` installed before or after `LsdClient`, each retry and redirect hop is drawn as its own call, and the app still gets every body.

### Message labels

A WebSocket message's arrow has a short label, and its body is in the arrow's popup (folded if it is JSON). The label is `text message`, or `binary (3 bytes)`, unless the message was written through a converter wrapped in `LsdKtor.labelled(...)` (`sendSerialized`): then it is the simple name of the class written, such as `PriceChanged`. Reading through it (`receiveDeserialized`) is unchanged.

The name is remembered for the message's content, so it labels the arrow at whichever end in this JVM draws it: a test's client and the app's server, in memory or over a real socket. Limits:

- A message from outside this JVM, or written without a wrapped converter, keeps the default label, unless it is byte for byte one a wrapped converter wrote here: the label comes from the bytes the converter wrote, never from reading the JSON.
- JDK and Kotlin types (a `String`, a `List<PriceChanged>`) and anonymous classes keep the default label; wrap a converter for classes of the app's own.
- Bytes written from two different classes keep the default label rather than naming either. Messages over 64 KiB are not named, and only the 512 most recently written or looked up are remembered.

## What a test looks like

```kotlin
@ExtendWith(LsdExtension::class)
class ShopTest {
    @Test
    fun `an order for a lamp in stock is created`() = testApplication {
        val outbound = client
        externalServices {
            hosts("http://inventory") { inventory() } // installs Lsd { app = "Inventory" }
        }
        application { shop(stock = outbound.config { install(LsdClient) { target = "Inventory" } }) }

        val response = client.post("/orders/lamp-01") {
            contentType(ContentType.Application.Json)
            setBody("""{"quantity":1}""")
        }
        assertEquals(HttpStatusCode.Created, response.status)
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

The call to Inventory is drawn once, by Inventory's server plugin under Inventory's name: a client plugin whose call reaches the server plugin in the same JVM leaves the drawing to it, in memory or over a socket, whatever address it was called by. The client plugin knows this from LSD's opaque `lsd-call` id, which it sends to every host. Without a server plugin at the other end (a fake, or a real third party) the client plugin draws the call itself.

## Sample report

[The sample report](https://lsd-consulting.github.io/lsd-mono/ktor-3/) is what this module's own fixtures draw: [the shop in `testApplication`](https://lsd-consulting.github.io/lsd-mono/ktor-3/shop-report.html), with a test that fails on purpose so the report shows an error scenario; [the same shop on CIO servers](https://lsd-consulting.github.io/lsd-mono/ktor-3/server-shop-report.html), called over sockets; and [a WebSocket of live prices](https://lsd-consulting.github.io/lsd-mono/ktor-3/live-prices-report.html), with its messages labelled `Subscribe` and `PriceChanged`, a busy socket capped, and the shop quoting a price through its own WebSocket client. The source is in [`fixture/`](https://github.com/lsd-consulting/lsd-mono/tree/main/modules/lsd-mono-ktor-3/src/test/kotlin/io/lsdconsulting/lsd/mono/ktor/fixture).

Build it yourself with `./gradlew :modules:lsd-mono-ktor-3:sampleReport` and open `modules/lsd-mono-ktor-3/build/pages/index.html`.

## What is drawn

- **Requests the app serves** (`Lsd`): the request as `METHOD /path?query` with its headers and body, before the handler runs; the reply as its status (`201 Created`) with headers, body and latency. A reply StatusPages makes from an exception is drawn as that reply; an exception nothing handles is drawn as an error reply (`IllegalStateException`) and rethrown.
- **Calls the app makes** (`LsdClient`): the same, from the app being served to the target, nested under the request being served; a client exception (`ConnectException`) is drawn as an error reply and rethrown, a timeout as the exception the caller sees (`HttpRequestTimeoutException`), even when the server plugin in this JVM drew the request. Each retry (`HttpRequestRetry`) and redirect hop (`HttpRedirect`) is drawn as its own call.
- **Scenario propagation**: the scenario travels in the coroutine context while the app serves a call, so its `HttpClient` calls are drawn in the right test even with several running. The client plugin sends core's `lsd-scenario` header, and the caller's name, to the hosts `lsd.mono.propagation.allowedHosts` allows (by default only loopback; any other host, a redirect's included, gets only the opaque `lsd-call` id), and to any host when the call stays in memory (a `testApplication` client, whose `externalServices` hosts are not real hosts); the server plugin reads it. With no header, the server captures into the bound scenario, or the only one running (see [Threads and parallel tests](../lsd-mono-core/README.md#threads-and-parallel-tests)).
- **Bodies, without consuming them or holding them up**: a body of known length up to 256 KiB is read and handed on as the same bytes. A response of unknown length (chunked, streamed) is handed on at once and copied as the caller reads it: its reply is drawn when the caller has read it to the end (with the body if it came to no more than 256 KiB, else a note of its size; one closed before its end is marked `closed after N bytes, not read to the end`). A request of unknown length is handed to the app unread and drawn as a note (`a stream of unknown length, passed on unread`), since the request is drawn before the app reads it. A body over 256 KiB, a server-sent event stream and a compressed body (`Content-Encoding`, never decompressed or read) are shown as a short note instead. A body whose content type is `application/json` or `+json` is shown as a structure the inspector can fold, read by a small built-in reader so the module needs no JSON library; so is a WebSocket text message that is a JSON object or array. Any other body is shown as text.
- **WebSockets the app serves** (`Lsd` with Ktor's `WebSockets`): the handshake as a call (`GET /prices`, `101 Switching Protocols`), each message as an arrow (labelled as in [Message labels](#message-labels), with the body in its popup; a text message over 256 KiB has its body noted as not shown, and one sent in fragments or compressed is noted as such), an error that ends the handler as an error arrow, and the close (`close 1000 done`) from whichever side closed, once. A busy socket draws its first `messagesShown` messages and a note of how many more it left out (`… 8 more WebSocket messages not drawn`). Calls the app makes while handling a message are drawn from the app, nested under the last message in.
- **WebSockets the app opens** (`LsdClient` with the client's `WebSockets`, `client.webSocket { }`): the same, from the app being served (else `caller`) to the target. The handshake carries the scenario like the client's calls, so a socket that reaches the server plugin in this JVM is drawn there, once, under the server's name; otherwise the client draws it, including a refused handshake (`404 Not Found`) or a failed connect.
- LSD's own `lsd-*` headers are left off the diagram.

## Not covered (yet)

- **Messages on other client engines**: the client draws a WebSocket's messages on CIO and the `testApplication` client. OkHttp and Java engine sessions are drawn as their handshake only (and in full by the server plugin, when the server is in this JVM).
- **Messages the app never reads**: messages are drawn as they arrive at the socket, so ones the app's handler leaves unread are drawn all the same.
- **`select` over a session's channels** (`incoming.onReceive`, `outgoing.onSend`): those messages are not drawn.
- **Class names for messages read, not written, in this JVM**: a message from a service outside the test keeps the default label, even if the app reads it through a wrapped converter. A message sent in fragments or compressed (`permessage-deflate`) keeps the default label too.
- **Request streams of unknown length** are not shown: the app gets them unread, and the report has a note in their place.
- **A streamed reply nobody reads**: a response of unknown length is drawn once it has been read to the end. One the caller never reads leaves the request drawn without its reply. `HEAD` requests and a reply the app never writes are drawn without a body.
- **Thread hops outside coroutines**: a call the app makes on a thread it starts itself (not a coroutine of the call) is not nested under the request being served. Carry the scenario with `LsdContext.instance.wrap(task)`.
- **Ktor internals**: the body capture uses two of Ktor's `@InternalAPI` calls (handing on a request body that was read, and a response body as it is copied), which is one reason the module is pinned to Ktor 3.
- No PlantUML, and nothing outside the two plugins (no Java agent, no global client interception): an app or `HttpClient` without them is not drawn.

## Versions

Ktor 3 only: the catalog holds the exact version (the `ktor-bom`), and the build fails if anything resolves to another Ktor major. Ktor 4 would be a separate `lsd-mono-ktor-4` module, as http4k 7 would be next to `lsd-mono-http4k-6`.
