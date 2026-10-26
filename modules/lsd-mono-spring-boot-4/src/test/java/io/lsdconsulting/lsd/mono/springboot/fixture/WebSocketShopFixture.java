package io.lsdconsulting.lsd.mono.springboot.fixture;

import static org.assertj.core.api.Assertions.assertThat;

import io.lsdconsulting.lsd.mono.springboot.LsdWebSocketClient;
import java.lang.reflect.Type;
import java.net.URI;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.SpringBootConfiguration;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Controller;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.WebSocketClient;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.WebSocketStompClient;

/**
 * A shop with no LSD code that quotes prices over WebSockets: a raw {@code @EnableWebSocket}
 * handler at {@code /prices}, and a STOMP endpoint at {@code /stomp} whose {@code @MessageMapping}
 * takes a {@link QuoteRequest} and answers on {@code /topic/prices} with a {@link PriceChanged}.
 * The tests open their sockets through {@code LsdWebSocketClient.wrap(...)}, all but one, which
 * shows a plain client is drawn the same. Launched by StarterEndToEndTest, and part of the sample report.
 */
@Tag("lsd-fixture")
@SpringBootTest(
        classes = WebSocketShopFixture.App.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.application.name=shop")
public class WebSocketShopFixture {
    public record QuoteRequest(String sku) {}

    public record PriceChanged(String sku, double price) {}

    @SpringBootConfiguration(proxyBeanMethods = false)
    @EnableAutoConfiguration
    static class App {
        @Configuration(proxyBeanMethods = false)
        @EnableWebSocket
        static class Raw implements WebSocketConfigurer {
            @Override
            public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
                registry.addHandler(new Prices(), "/prices");
            }
        }

        @Configuration(proxyBeanMethods = false)
        @EnableWebSocketMessageBroker
        static class Stomp implements WebSocketMessageBrokerConfigurer {
            @Override
            public void registerStompEndpoints(StompEndpointRegistry registry) {
                registry.addEndpoint("/stomp");
            }

            @Override
            public void configureMessageBroker(MessageBrokerRegistry registry) {
                registry.enableSimpleBroker("/topic");
                registry.setApplicationDestinationPrefixes("/app");
                registry.setPreservePublishOrder(true);
            }

            @Override
            public void configureClientInboundChannel(org.springframework.messaging.simp.config.ChannelRegistration registration) {
                registration.taskExecutor().corePoolSize(1);
            }
        }

        @Controller
        static class Quotes {
            @MessageMapping("/quote")
            @SendTo("/topic/prices")
            PriceChanged quote(QuoteRequest request) {
                return new PriceChanged(request.sku(), 12.5);
            }
        }

        /** Counts STOMP sessions the broker has seen end, so a test can wait for its own. */
        @Component
        static class Disconnects {
            final CountDownLatch ended = new CountDownLatch(1);

            @EventListener
            void on(SessionDisconnectEvent event) {
                ended.countDown();
            }
        }

        /**
         * {@code {"sku":"lamp-01"}} is answered with its price; {@code flood} with 25 ticks; {@code
         * boom} fails; {@code bye} closes the socket from the server.
         */
        static class Prices extends TextWebSocketHandler {
            @Override
            protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
                String text = message.getPayload();
                switch (text) {
                    case "bye" -> session.close(CloseStatus.NORMAL.withReason("bye"));
                    case "boom" -> throw new IllegalStateException("no price for boom");
                    case "flood" -> {
                        for (int i = 1; i <= 25; i++) session.sendMessage(new TextMessage("{\"tick\":" + i + "}"));
                    }
                    default -> session.sendMessage(new TextMessage("{\"sku\":\"lamp-01\",\"price\":12.5}"));
                }
            }
        }
    }

    @LocalServerPort
    int port;

    @Autowired
    App.Disconnects disconnects;

    /** What a socket the test opened received, and when it closed. */
    static class Received extends TextWebSocketHandler {
        final List<String> messages = new CopyOnWriteArrayList<>();
        final CompletableFuture<CloseStatus> closed = new CompletableFuture<>();
        private volatile CountDownLatch expected = new CountDownLatch(0);

        void expect(int count) {
            expected = new CountDownLatch(count);
        }

        void await() throws InterruptedException {
            assertThat(expected.await(10, TimeUnit.SECONDS)).isTrue();
        }

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            messages.add(message.getPayload());
            expected.countDown();
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            closed.complete(status);
        }
    }

    private WebSocketSession open(WebSocketClient client, Received received) throws Exception {
        return client.execute(received, null, URI.create("ws://localhost:" + port + "/prices")).get(10, TimeUnit.SECONDS);
    }

    @Test
    void quotesAPriceOverAWebSocket() throws Exception {
        Received received = new Received();
        WebSocketSession socket = open(LsdWebSocketClient.wrap(new StandardWebSocketClient()), received);

        received.expect(1);
        socket.sendMessage(new TextMessage("{\"sku\":\"lamp-01\"}"));
        received.await();
        socket.sendMessage(new TextMessage("bye"));

        assertThat(received.closed.get(10, TimeUnit.SECONDS).getCode()).isEqualTo(1000);
        assertThat(received.messages).containsExactly("{\"sku\":\"lamp-01\",\"price\":12.5}");
    }

    @Test
    void streamsPricesOverStomp() throws Exception {
        WebSocketStompClient stomp = new WebSocketStompClient(LsdWebSocketClient.wrap(new StandardWebSocketClient()));
        stomp.setMessageConverter(new JacksonJsonMessageConverter());
        StompSession session = stomp.connectAsync("ws://localhost:" + port + "/stomp", new StompSessionHandlerAdapter() {})
                .get(10, TimeUnit.SECONDS);
        CompletableFuture<PriceChanged> price = new CompletableFuture<>();
        session.subscribe("/topic/prices", new StompFrameHandler() {
                    @Override
                    public Type getPayloadType(StompHeaders headers) {
                        return PriceChanged.class;
                    }

                    @Override
                    public void handleFrame(StompHeaders headers, Object payload) {
                        price.complete((PriceChanged) payload);
                    }
                });
        // The subscription is in place before the quote is asked for: the app keeps each socket's frames in order.
        session.send("/app/quote", new QuoteRequest("lamp-01"));

        assertThat(price.get(10, TimeUnit.SECONDS)).isEqualTo(new PriceChanged("lamp-01", 12.5));
        session.disconnect();
        assertThat(disconnects.ended.await(10, TimeUnit.SECONDS)).isTrue();
    }

    @Test
    void failsToQuoteAnUnknownProduct() throws Exception {
        Received received = new Received();
        WebSocketSession socket = open(LsdWebSocketClient.wrap(new StandardWebSocketClient()), received);

        socket.sendMessage(new TextMessage("boom"));

        assertThat(received.closed.get(10, TimeUnit.SECONDS).getCode()).isEqualTo(1011);
    }

    @Test
    void streamsMoreTicksThanAreDrawn() throws Exception {
        Received received = new Received();
        // A plain client: the app's side draws the socket all the same.
        WebSocketSession socket = open(new StandardWebSocketClient(), received);

        received.expect(25);
        socket.sendMessage(new TextMessage("flood"));
        received.await();
        socket.sendMessage(new TextMessage("bye"));

        assertThat(received.closed.get(10, TimeUnit.SECONDS).getCode()).isEqualTo(1000);
    }
}
