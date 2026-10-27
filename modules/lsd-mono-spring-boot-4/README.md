# lsd-mono-spring-boot-4

`lsd-mono-spring-boot-4` is the Spring Boot 4 starter for [lsd-mono-jvm](../lsd-mono-jvm). Add it to the tests and an existing `@SpringBootTest` suite writes living sequence diagrams with no code changes: one scenario per test method, one report per test class, and `index.html`. There is no PlantUML on this path.

It draws:

- **inbound Spring MVC** requests the app serves (`Client → Shop: POST /orders`, and the reply with its status and latency);
- **inbound WebFlux** requests, annotated controllers and router functions alike, drawn the same way;
- **`WebTestClient` requests** from Spring Boot's auto-configured client (`@AutoConfigureWebTestClient`), bound to the application context or to a running server, drawn in the test's scenario like any other request to the app, and one the test builds itself ([below](#a-webtestclient-the-test-builds-itself));
- **outbound `RestClient` and `RestTemplate`** calls made through Spring Boot's `RestClient.Builder` and `RestTemplateBuilder` (`Shop → Pricing: POST /quotes`), with a server-sent event reply drawn as its events while the app streams it;
- **outbound `WebClient`** calls through any `WebClient.Builder` or `WebClient` bean, Spring Boot's builder or one the app builds itself, with both bodies, and nested under the request being served even after the reactive chain hops threads;
- **Kafka records sent** through any Spring producer factory the app's beans use (Spring Boot's own, or one the app builds itself), so any `KafkaTemplate`, as a publish from the app to the topic (`Shop → orders.placed: publish "lamp-01"`, with the key, headers and payload);
- **Kafka sends that fail**, when the producer rejects the record or the broker never acknowledges it, as an error reply from the topic to the sender, named after the exception (`orders.placed → Shop: RecordTooLargeException`) with its message, so the scenario's errors count it. A successful acknowledgement adds nothing to the diagram, and one that arrives after its test has finished is dropped. This needs `kafka-clients` 4.1 or later (the version Spring Boot 4 manages), the first whose producer interceptors are handed the record's headers on acknowledgement; with an older client (3.x or 4.0) a failed send is still drawn as a plain publish;
- **Kafka records consumed** by Spring listener containers, so any `@KafkaListener`, whether its container factory is Spring Boot's or the app's, as a consume from the topic to the app, paired with its publish when the test's JVM sent it. A batch listener (`List<ConsumerRecord>` or a `List` of payloads, on a batch factory such as Boot's with `spring.kafka.listener.type=batch`) draws each record in the batch as its own consume (`orders.placed → Shop: consume "lamp-01"`), just as a record listener does;
- **Spring Data repository calls**, any store, as a call and its reply (`Shop → OrderRepository: save(PlacedOrder(id=7, …))`, then what came back), with a one-line summary of the arguments and the result.
- **WebSockets, STOMP included**, in a servlet app: each `@EnableWebSocket` handler and each `@EnableWebSocketMessageBroker` STOMP endpoint, as the handshake, each message either way (labels in the popup), errors and the close ([below](#websockets)).

Each part switches on only when its classes are on the test classpath. Nothing below a repository is drawn (no JDBC, no SQL), and JMS is not captured.

## Depend on it

```kotlin
testImplementation("io.github.lsd-consulting:lsd-mono-spring-boot-4:<version>")
```

The version is on the [Maven Central badge](../../README.md#jvm-kotlin-java) in the root README. From another project in this repo: `testImplementation(project(":modules:lsd-mono-spring-boot-4"))`.

That pulls in `lsd-mono-jvm`. Spring itself is not: the starter is compiled against Spring Boot 4 (Spring Framework 7, Jackson 3) and uses the app's own Boot 4.x, JUnit included. It needs nothing beyond what `spring-boot-starter-test` already brings.

## What a test looks like

Nothing changes in the test:

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class PlaceOrderTest {
    @Test
    void placesAnOrder() { /* call the app as you already do */ }
}
```

The report is titled after the class (`place order`), each scenario after the method (`place order: places an order`), or after `@DisplayName` when there is one. A failed test is an error scenario with its reason; an aborted one is a warning.

## A WebTestClient the test builds itself

Bound to the application context (`WebTestClient.bindToApplicationContext(context)`) or to the running server (`bindToServer()`), it needs nothing: the app's own filter draws its requests, in the test's scenario while one test runs at a time. Bound to a controller, router function or web handler, the app's filters are not in the chain and nothing is drawn, and with tests running in parallel a request may land outside its test's scenario. One line covers both:

```java
WebTestClient client = WebTestClient.bindToController(new OrderController())
        .configureClient()
        .apply(LsdWebTestClient.configurer())
        .build();
```

It sends the test's scenario with each request and, with no app filter in the chain, draws the requests itself, with the same names as the app's own filter: the app is named from the test's application context (`lsd.mono.spring.app-name`, else `spring.application.name`) and the caller is `lsd.mono.spring.client-name` (`Client` by default), so the app is one participant however the client is bound. `lsd.mono.spring.multipart.parts.enabled` is read from the same context. Applying it twice, or to Spring Boot's client, adds nothing.

## WebSockets

A servlet app's WebSockets are drawn with nothing to add: each `@EnableWebSocket` handler, and each STOMP endpoint of an `@EnableWebSocketMessageBroker` app, is decorated as the app starts. A socket the test opens to the app is drawn by the app's side:

- the handshake, as the request and its reply (`GET /prices` → `101 Switching Protocols`);
- each message either way, the caller's to the app and the app's back;
- the close, from whichever side closed first (`close 1000 bye`);
- an error: a handler that throws is drawn as the exception, from the app, then the `close 1011` the app makes.

Calls the app makes while it handles a message are drawn under that message. Only the first 20 messages of a socket are drawn (`lsd.mono.spring.websocket.messages-shown`); the rest are counted in a note when it closes (`… 7 more WebSocket messages not drawn`). Pings and pongs are not drawn.

Labels are short, and the content is in the popup (folded when it is JSON; a text message over 256 KiB is noted, not shown):

- A raw message is `text message` or `binary (3 bytes)`: the app writes it itself, so its class is not known.
- A STOMP frame is labelled with its destination and the class its payload is read into or written from: `QuoteRequest /app/quote` for a `SEND` that a `@MessageMapping` method taking a `QuoteRequest` handles, `PriceChanged /topic/prices` for the `MESSAGE` a `@SendTo` or `SimpMessagingTemplate` writes from a `PriceChanged`, else `SEND /app/quote` or `MESSAGE /topic/prices`. `SUBSCRIBE` and `UNSUBSCRIBE` frames are drawn, and so is each `ERROR` frame the app sends, as `ERROR` with its `message` header and body in the popup (one an app's channel interceptor causes by refusing a frame too, then the `close 1002` the app makes); `CONNECT`, heartbeats, `DISCONNECT` and receipts are not.

The test's own client needs one line, so its handshake carries the test's scenario (a socket to another server is drawn by the client: the handshake, messages either way, the close and errors, with the same cap). A `WebSocketStompClient` takes the wrapped client:

```java
WebSocketClient client = LsdWebSocketClient.wrap(new StandardWebSocketClient());
WebSocketSession socket = client.execute(handler, null, URI.create("ws://localhost:" + port + "/prices")).get();

WebSocketStompClient stomp = new WebSocketStompClient(LsdWebSocketClient.wrap(new StandardWebSocketClient()));
```

An unwrapped client still works while one test runs at a time: the app draws its side in the running scenario. A socket to the app is drawn once either way. [`WebSocketShopFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebSocketShopFixture.java) has both kinds ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/websocket-report.html)).

## Sample report

[The sample report](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/) ([one scenario on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/kafka-shop-report.html), [the WebFlux shop](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/webflux-report.html)) is what this module's own shop fixtures draw. They are plain `@SpringBootTest` classes that know nothing about LSD; the starter on the test classpath is all it takes:

The site is rebuilt from each release, so a fixture's report appears there with the first release after the fixture is merged.

```java
@EmbeddedKafka(partitions = 1, topics = ShopApp.TOPIC)
@SpringBootTest(
        classes = ShopApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"spring.application.name=shop", "shop.events.enabled=true", /* ... */})
public class KafkaShopFixture {
    @Test
    void announcesAnOrder() throws Exception {
        // POST /orders/lamp-01 and wait for the order to be handled
        assertThat(CLIENT.send(request, HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(201);
        assertThat(handled.await(30, TimeUnit.SECONDS)).isTrue();
    }
}
```

The shop calls Inventory and Pricing over HTTP, saves the order through `OrderRepository`, publishes to `orders.placed` and consumes it again, and all of that is on the diagram. The full source is in [`fixture/`](https://github.com/lsd-consulting/lsd-mono/tree/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture) ([`KafkaShopFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/KafkaShopFixture.java), [`ShopFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/ShopFixture.java), [`ShopApp`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/ShopApp.java)). `ShopFixture` has a test that fails on purpose, so the report shows an error scenario too, [`KafkaSendFailureFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/KafkaSendFailureFixture.java) gives the shop a producer that refuses its own event, so the report shows a failed send ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/kafka-send-failure-report.html)), and [`KafkaBatchListenerFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/KafkaBatchListenerFixture.java) has the shop take three orders as one batch on Spring Boot's batch factory and save them in one call ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/kafka-batch-listener-report.html)). [`WebFluxShopFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebFluxShopFixture.java) runs a reactive version of the shop ([`WebFluxShopApp`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebFluxShopApp.java)): a controller that calls Pricing and then Inventory over `WebClient` after hopping schedulers, and a router function whose tracking service answers 404. [`AsyncShopFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/AsyncShopFixture.java) places two orders at once in an app ([`AsyncShopApp`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/AsyncShopApp.java)) that prices each on a pool of its own and saves it in an `@Async` method, and [`WebFluxBookingsFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebFluxBookingsFixture.java) books two orders at once in the reactive shop, saving and announcing each on Kafka after a thread hop: every call stays under the request that made it ([async](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/async-shop-report.html), [reactive](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/webflux-bookings-report.html)). [`KafkaRecordListenerFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/KafkaRecordListenerFixture.java) has a record listener take three orders in one poll, each save under its own consume ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/kafka-record-listener-report.html)); [`OwnClientsFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/OwnClientsFixture.java) builds its `RestClient`, `RestTemplate` and `RestTemplateBuilder` itself ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/own-clients-report.html)); [`MvcStreamsFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/MvcStreamsFixture.java) and [`WebFluxStreamsFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebFluxStreamsFixture.java) stream server-sent events, upload multipart files and fail in the usual ways, drawn as the events, the parts and Spring Boot's error bodies ([MVC](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/mvc-streams-report.html), [reactive](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/webflux-streams-report.html)); [`WebTestClientFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebTestClientFixture.java) tests a reactive shop through Spring Boot's `WebTestClient`, with no server, including multipart uploads and a 404 ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/webtestclient-report.html)); [`RestClientStreamsFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/RestClientStreamsFixture.java) follows a courier's event stream through a `RestClient` and a `RestTemplate` ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/rest-client-streams-report.html)); and [`WebSocketShopFixture`](https://github.com/lsd-consulting/lsd-mono/blob/main/modules/lsd-mono-spring-boot-4/src/test/java/io/github/lsdconsulting/lsd/mono/springboot/fixture/WebSocketShopFixture.java) quotes prices over a raw WebSocket and over STOMP ([on its own](https://lsd-consulting.github.io/lsd-mono/spring-boot-4/websocket-report.html)).

Build it yourself with `./gradlew :modules:lsd-mono-spring-boot-4:sampleReport` and open `modules/lsd-mono-spring-boot-4/build/pages/index.html`.

## Names on the diagram

- The app is `spring.application.name`, humanised (`orders-service` → `Orders service`), else `App`.
- Whoever calls it from the test is `Client`.
- A service it calls is named after the property holding its URL: with `shop.payments.url=http://localhost:58231`, a call to `http://localhost:58231/charges` is to `Payments` (`ws://` and `wss://` URLs too). Otherwise it is the host (and port, for loopback).
- A Kafka topic is its name (`orders.placed`), drawn as a queue.
- A repository is its interface's simple name (`OrderRepository`), drawn as a database.
- A call made while the app serves a request or runs a Kafka listener is the app's, including one made on another thread the request handed work to (see below); one made straight from the test method is `Client`'s.

| Property | Default | Meaning |
|---|---|---|
| `lsd.mono.spring.enabled` | `true` | `false` turns the starter off |
| `lsd.mono.spring.app-name` | from `spring.application.name` | the app's participant name |
| `lsd.mono.spring.client-name` | `Client` | the test's participant name |
| `lsd.mono.spring.kafka.consumer.enabled` | `true` | `false` leaves Kafka consumes out (sends are still drawn) |
| `lsd.mono.spring.repositories.enabled` | `true` | `false` leaves Spring Data repository calls out |
| `lsd.mono.spring.executors.enabled` | `true` | `false` leaves Spring's task executors and schedulers undecorated, and plain `ExecutorService` beans unwrapped |
| `lsd.mono.spring.reactor.context-propagation.enabled` | `true` | `false` stops the starter turning on Reactor's automatic context propagation |
| `lsd.mono.spring.websocket.enabled` | `true` | `false` leaves the app's WebSockets and STOMP frames undrawn |
| `lsd.mono.spring.websocket.messages-shown` | `20` | how many messages of one socket are drawn before the rest are counted in a note; a negative value is refused (the app does not start) |
| `lsd.mono.spring.multipart.parts.enabled` | `true` | `false` stops the starter reading a multipart request's parts, in the servlet filter and in a reactive app (the servlet filter also leaves them alone with `spring.servlet.multipart.enabled=false` or `resolve-lazily=true`) |

Report output (directory, title and so on) is configured as for core (`lsd.mono.report.*`).

## With LsdExtension

A test class that already has `@ExtendWith(LsdExtension::class)` ([lsd-mono-junit-jupiter](../lsd-mono-junit-jupiter)) is left to the extension: the starter writes no second report for it and draws nothing in it.

## How it works

- `LsdAutoConfiguration` (`META-INF/spring/…AutoConfiguration.imports`) registers a servlet filter, and `RestClientCustomizer` and `RestTemplateCustomizer` beans that add a client interceptor. A bean post-processor adds the interceptor, once, to the clients an app builds itself as beans: a `RestClient` or `RestClient.Builder` from `RestClient.builder()`, a `RestTemplate` made with `new`, and a `RestTemplateBuilder` the app declares.
- The servlet filter writes the response through to the client as the app writes it, copying the first 256 KB, so a stream (`SseEmitter`, `ResponseBodyEmitter`) reaches the client as it is sent. An asynchronous request is answered when it completes. When a handler fails, by an exception or `sendError`, the filter also sees Spring Boot's `/error` dispatch and draws the body it writes (the error attributes JSON); a `ProblemDetail` from the app's own handler is drawn as written. Under MockMvc, which runs no error page, the reply is what the handler left.
- In a reactive app it registers a `WebFilter` instead of the servlet filter. A small request body of known length is read up front and handed to the app again; the response body is copied as it is written, never consumed. The request being served goes into Reactor's context, so a `WebClient` call nests under it on whatever thread it runs. An `HttpHandlerDecoratorFactory` bean wraps the server's handler, and a `WebTestClient`'s bound to the context, which Spring builds the same way. During a scenario it wraps the response, so after a failure the reply drawn is the body the `WebExceptionHandler` writes (Spring Boot's error JSON), and it reads the head of a multipart request (up to 256 KB, sized or chunked) before the app does, then hands every byte on, so `@RequestPart` and `ServerRequest.multipartData()` work as before. It has to sit there rather than in the `WebFilter`: WebFlux parses multipart data from the request the exchange was created with.
- A `WebTestClientBuilderCustomizer` adds a filter to Spring Boot's `WebTestClient` that sends the test's scenario in `lsd-scenario` (always when bound to the context, where nothing leaves the JVM; to loopback hosts or `lsd.mono.propagation.allowedHosts` when bound to a server), so the app's own filter draws the request in the right scenario. `LsdWebTestClient.configurer()` adds the same filter to a client the test builds, and, when it is bound to a controller, router function or web handler, the starter's `WebFilter` and response wrapper.
- For `WebClient` it registers a bean post-processor that adds an `ExchangeFilterFunction` to every `WebClient.Builder` bean (Spring Boot's included) and rebuilds every `WebClient` bean that lacks it. The reply is drawn when the app has read its body.
- Streamed bodies are summarised, never consumed or held whole: a server-sent event stream is drawn as its event count and its first five events (`event`, `id`, `data`), a multipart body as its parts (name, file name, type and size, never the contents). A multipart or event-stream body over 256 KB is summarised from its first 256 KB and marked `truncated`. An event stream read through `RestClient` or `RestTemplate` is copied as the app reads it, and its reply is drawn once: when the app reads to the end, or, marked `truncated`, when it closes the stream before then.
- Not covered:
  - a client built inline and never a bean (`RestClient.create()`, `new RestTemplate()` in a method, `WebClient.create()`): neither Spring nor the clients offer a global hook short of bytecode instrumentation. Build it from Spring Boot's injected `RestClient.Builder`, `RestTemplateBuilder` or `WebClient.Builder`, or declare it as a bean;
  - a server-sent event response through `RestClient` or `RestTemplate` that the app neither reads to the end nor closes: its reply is never drawn, since nothing marks when the app is done with it. Reading it without the app would consume the stream, so the starter waits for the app;
  - a `WebTestClient` the test builds bound to a controller, router function or web handler, unless it applies `LsdWebTestClient.configurer()` ([above](#a-webtestclient-the-test-builds-itself)).
- Work a request hands to another thread keeps its scenario and the request that handed it over:
  - For Spring's `ThreadPoolTaskExecutor`, `ThreadPoolTaskScheduler` and `SimpleAsyncTaskExecutor` beans (Spring Boot's `applicationTaskExecutor`, so `@Async`, included) it registers a bean post-processor that adds a `TaskDecorator`. It is composed with the app's own decorator (a `CompositeTaskDecorator`, the app's inside), and captures the request when the task is submitted.
  - A plain `ExecutorService` or `ScheduledExecutorService` bean (`Executors.newFixedThreadPool(4)`, a `ThreadPoolExecutorFactoryBean` excepted) is wrapped so each task it is given keeps its scenario: `submit`, `execute`, `invokeAll`, `invokeAny` and the `schedule` methods. It is wrapped only when declared as one of those interfaces, so whatever injects it still gets what it asked for; Spring shuts the pool itself down as before.
  - In a reactive app, with `io.micrometer:context-propagation` on the test classpath (it is managed by Spring Boot's dependencies), it registers a `ThreadLocalAccessor` for the request it puts in Reactor's context and turns on `Hooks.enableAutomaticContextPropagation()`, as `spring.reactor.context-propagation=auto` does. A repository call or Kafka send made after `publishOn` or `subscribeOn` then nests under its own request, even with several served at once. Without the library those calls fall back to the most recent request in the scenario.
  - Not covered:
    - an executor bean declared as a class (`ThreadPoolExecutor`, `ForkJoinPool`, or a `@Component` that implements `ExecutorService`): declare it as `ExecutorService` instead;
    - an executor that is not a bean, `CompletableFuture.supplyAsync` without an executor, and the common `ForkJoinPool`: there is no hook short of instrumentation. Pass the wrapped bean (`supplyAsync(work, pool)`);
    - a periodic `@Scheduled` task: it is scheduled at startup, outside any scenario, so its calls are drawn as the test's when one test is running and left out otherwise. A task a request schedules on a `ScheduledExecutorService` bean keeps that request's scenario.
- For Kafka it registers a bean post-processor that appends a Kafka `ProducerInterceptor` and `ConsumerInterceptor` to the app's own `interceptor.classes` in every `ProducerFactory` and `ConsumerFactory` bean, and in the factory behind every `KafkaTemplate` and listener container factory bean, so factories the app builds itself are covered as well as Spring Boot's. Not covered yet:
  - a `ConcurrentMessageListenerContainer` or `KafkaMessageListenerContainer` declared directly as a bean, rather than made by a listener container factory;
  - a custom `KafkaListenerContainerFactory` that does not extend `AbstractKafkaListenerContainerFactory`;
  - a `ProducerFactory` or `ConsumerFactory` whose `updateConfigs` is the interface's default no-op (it is skipped without a warning);
  - a raw `KafkaProducer` or `KafkaConsumer` made with `new`, outside any Spring factory;
  - which record of a batch a batch listener's calls belong to: one call usually serves the whole batch, so they are linked to the batch's last record.
- A record listener's calls are linked to the record it is handling, even when one poll brought several: a `RecordInterceptor` and `BatchInterceptor` are put on every listener container factory, in front of the app's own (composed, so the app's keep running).
- A consume is drawn when the consumer polls the record, so a batch listener's records are all drawn before it runs, in the order Kafka returned them; records polled together carry a `kafka.poll` header (`2 of 3`). The publish adds an `lsd-publish-id` record header to pair the two, and each record in a batch keeps its own.
- For Spring Data it registers a bean post-processor that adds a method interceptor to every repository proxy through `RepositoryFactoryBeanSupport`, as Spring Boot's repository metrics do. Arguments and results are summarised, never walked, so a lazy JPA association is not loaded to draw it.
- For WebSockets it registers a bean post-processor that re-registers each `WebSocketHttpRequestHandler` in the app's `WebSocketHandlerMapping` with a decorated handler and a `HandshakeInterceptor`, which notes the handshake's scenario and caller on the session (the servlet filter draws the handshake itself). For STOMP it adds a `WebSocketMessageBrokerConfigurer` whose channel interceptors draw the client's inbound and outbound frames, and swaps the `brokerMessageConverter` bean for one with the same converters that names each payload's class in a message header (not a STOMP header, so it never reaches the wire). `LsdWebSocketClient.wrap` decorates a `WebSocketClient`'s handler and session the same way. Not covered:
  - SockJS endpoints (`.withSockJS()`): they are served by a different request handler and are left undrawn;
  - WebSockets in a reactive (WebFlux) app;
  - a class name on a raw message: the app serialises it itself, so it is `text message`;
  - a STOMP app on an external broker relay: frames are drawn, but a `MESSAGE` the relay delivers is labelled `MESSAGE /topic/…`, as the class header does not survive the broker;
  - a client socket opened with a `WebSocketClient` the test does not wrap, to a server other than the app;
  - a wrapped client's socket to the app's own server when the app's side does not draw it (`lsd.mono.spring.websocket.enabled=false`, or a SockJS endpoint): the client leaves it to the app's side, so it is not drawn at all;
  - the HTTP status of a handshake another server refuses: it is drawn with the exception's class (`DeploymentException`);
  - a message the app sends that is dropped after it is drawn (a `ConcurrentWebSocketSessionDecorator` over its buffer limit): sends are drawn as the app makes them;
  - STOMP sessions are matched to their frames by the container's session id, unique within Tomcat; two servers in one JVM whose containers reuse ids could mix up their frames.
- `LsdSpringTestListener` (`META-INF/spring.factories`) is a Spring `TestExecutionListener` that begins and completes the scenarios and writes the report.
- Every part is a no-op unless a test scenario is running, and capture never fails the app or the test: a failure is logged once and the event is left out.

## Versions

Spring Boot 4 only; the build fails if anything resolves to another Spring Boot or Spring Framework major. Spring Boot 5 will be a separate `lsd-mono-spring-boot-5` module, as Cucumber 9 would be next to `lsd-mono-cucumber-8`. The starter's own tests run on the JUnit that the Spring Boot BOM manages (6.0.x for Boot 4.1), not the repo's newer JUnit, since that is what an app on Boot has.
