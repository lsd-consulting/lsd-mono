# lsd-mono-spring-boot-4

`lsd-mono-spring-boot-4` is the Spring Boot 4 starter for [lsd-mono-core](../lsd-mono-core). Add it to the tests and an existing `@SpringBootTest` suite writes living sequence diagrams with no code changes: one scenario per test method, one report per test class, and `index.html`. There is no PlantUML on this path.

It draws:

- **inbound Spring MVC** requests the app serves (`Client → Shop: POST /orders`, and the reply with its status and latency);
- **outbound `RestClient` and `RestTemplate`** calls made through Spring Boot's `RestClient.Builder` and `RestTemplateBuilder` (`Shop → Pricing: POST /quotes`);
- **Kafka records sent** through Spring Boot's producer factory, so any `KafkaTemplate` it backs, as a publish from the app to the topic (`Shop → orders.placed: publish "lamp-01"`, with the key, headers and payload);
- **Kafka records consumed** by Spring Boot's listener containers, so any `@KafkaListener`, as a consume from the topic to the app, paired with its publish when the test's JVM sent it;
- **Spring Data repository calls**, any store, as a call and its reply (`Shop → OrderRepository: save(PlacedOrder(id=7, …))`, then what came back), with a one-line summary of the arguments and the result.

Each part switches on only when its classes are on the test classpath. Nothing below a repository is drawn (no JDBC, no SQL), and WebFlux, `WebClient` and JMS are not captured.

## Depend on it

```kotlin
testImplementation("io.github.lsd-consulting:lsd-mono-spring-boot-4:<version>")
```

The version is on the [Maven Central badge](../../README.md#getting-started) in the root README. From another project in this repo: `testImplementation(project(":modules:lsd-mono-spring-boot-4"))`.

That pulls in `lsd-mono-core`. Spring itself is not: the starter is compiled against Spring Boot 4 (Spring Framework 7, Jackson 3) and uses the app's own Boot 4.x, JUnit included. It needs nothing beyond what `spring-boot-starter-test` already brings.

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

## Names on the diagram

- The app is `spring.application.name`, humanised (`orders-service` → `Orders service`), else `App`.
- Whoever calls it from the test is `Client`.
- A service it calls is named after the property holding its URL: with `shop.payments.url=http://localhost:58231`, a call to `http://localhost:58231/charges` is to `Payments`. Otherwise it is the host (and port, for loopback).
- A Kafka topic is its name (`orders.placed`), drawn as a queue.
- A repository is its interface's simple name (`OrderRepository`), drawn as a database.
- A call made while the app serves a request or runs a Kafka listener is the app's; one made straight from the test method is `Client`'s.

| Property | Default | Meaning |
|---|---|---|
| `lsd.mono.spring.enabled` | `true` | `false` turns the starter off |
| `lsd.mono.spring.app-name` | from `spring.application.name` | the app's participant name |
| `lsd.mono.spring.client-name` | `Client` | the test's participant name |
| `lsd.mono.spring.kafka.consumer.enabled` | `true` | `false` leaves Kafka consumes out (sends are still drawn) |
| `lsd.mono.spring.repositories.enabled` | `true` | `false` leaves Spring Data repository calls out |

Report output (directory, title and so on) is configured as for core (`lsd.mono.report.*`).

## With LsdExtension

A test class that already has `@ExtendWith(LsdExtension::class)` ([lsd-mono-junit-jupiter](../lsd-mono-junit-jupiter)) is left to the extension: the starter writes no second report for it and draws nothing in it.

## How it works

- `LsdAutoConfiguration` (`META-INF/spring/…AutoConfiguration.imports`) registers a servlet filter, and `RestClientCustomizer` and `RestTemplateCustomizer` beans that add a client interceptor.
- For Kafka it registers `DefaultKafkaProducerFactoryCustomizer` and `DefaultKafkaConsumerFactoryCustomizer` beans that append a Kafka `ProducerInterceptor` and `ConsumerInterceptor` to the app's own `interceptor.classes`. Producer and consumer factories the app builds itself, rather than Boot's, are not instrumented. A consume is drawn when the record is polled; the publish adds an `lsd-publish-id` record header to pair the two.
- For Spring Data it registers a bean post-processor that adds a method interceptor to every repository proxy through `RepositoryFactoryBeanSupport`, as Spring Boot's repository metrics do. Arguments and results are summarised, never walked, so a lazy JPA association is not loaded to draw it.
- `LsdSpringTestListener` (`META-INF/spring.factories`) is a Spring `TestExecutionListener` that begins and completes the scenarios and writes the report.
- Every part is a no-op unless a test scenario is running, and capture never fails the app or the test: a failure is logged once and the event is left out.

## Versions

Spring Boot 4 only; the build fails if anything resolves to another Spring Boot or Spring Framework major. Spring Boot 5 will be a separate `lsd-mono-spring-boot-5` module, as Cucumber 9 would be next to `lsd-mono-cucumber-8`. The starter's own tests run on the JUnit that the Spring Boot BOM manages (6.0.x for Boot 4.1), not the repo's newer JUnit, since that is what an app on Boot has.
