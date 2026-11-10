package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.beans.factory.ObjectProvider
import org.springframework.core.MethodParameter
import org.springframework.core.Ordered
import org.springframework.messaging.Message
import org.springframework.messaging.MessageChannel
import org.springframework.messaging.MessageHandler
import org.springframework.messaging.MessageHeaders
import org.springframework.messaging.converter.CompositeMessageConverter
import org.springframework.messaging.converter.MessageConverter
import org.springframework.messaging.handler.DestinationPatternsMessageCondition
import org.springframework.messaging.handler.annotation.DestinationVariable
import org.springframework.messaging.handler.annotation.Header
import org.springframework.messaging.handler.annotation.Headers
import org.springframework.messaging.handler.annotation.Payload
import org.springframework.messaging.simp.SimpMessageHeaderAccessor
import org.springframework.messaging.simp.SimpMessageType
import org.springframework.messaging.simp.annotation.support.SimpAnnotationMethodMessageHandler
import org.springframework.messaging.simp.config.ChannelRegistration
import org.springframework.messaging.simp.stomp.StompHeaderAccessor
import org.springframework.messaging.support.ExecutorChannelInterceptor
import org.springframework.messaging.support.MessageBuilder
import org.springframework.messaging.support.MessageHeaderAccessor
import org.springframework.util.ClassUtils
import org.springframework.web.socket.TextMessage
import org.springframework.web.socket.WebSocketHandler
import org.springframework.web.socket.WebSocketMessage
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer
import org.springframework.web.socket.handler.WebSocketHandlerDecorator
import org.springframework.web.socket.messaging.StompSubProtocolErrorHandler
import org.springframework.web.socket.messaging.StompSubProtocolHandler
import org.springframework.web.socket.messaging.SubProtocolWebSocketHandler
import java.security.Principal
import java.util.concurrent.ConcurrentHashMap

/**
 * STOMP over a WebSocket endpoint: the socket is drawn by [LsdWebSocketHandler] (its close and
 * errors), its frames from the broker's client channels, where each is a message the app
 * understands. A frame the caller sends is `SUBSCRIBE /topic/prices`, or `QuoteRequest /app/quote`
 * when the `@MessageMapping` method it goes to takes a `QuoteRequest` (else `SEND /app/quote`). A
 * frame the app sends is `PriceChanged /topic/prices` when the app's message converter wrote it
 * from a `PriceChanged` (else `MESSAGE /topic/prices`). Bodies go to the popup, never the label.
 */
internal object Stomp {
    val available: Boolean =
        ClassUtils.isPresent("org.springframework.messaging.simp.SimpMessageHeaderAccessor", Stomp::class.java.classLoader) &&
            ClassUtils.isPresent("org.springframework.web.socket.messaging.SubProtocolWebSocketHandler", Stomp::class.java.classLoader)

    private val sessions = ConcurrentHashMap<String, DrawnSession>()

    /** A STOMP endpoint's handler, under any decorators the app's `WebSocketTransportRegistration` added. */
    fun isEndpoint(handler: WebSocketHandler): Boolean = available && WebSocketHandlerDecorator.unwrap(handler) is SubProtocolWebSocketHandler

    fun opened(
        sessionId: String,
        drawn: DrawnSession,
    ) {
        sessions[sessionId] = drawn
    }

    fun closed(sessionId: String) {
        sessions.remove(sessionId)
    }

    fun session(message: Message<*>): DrawnSession? = SimpMessageHeaderAccessor.getSessionId(message.headers)?.let { sessions[it] }

    /**
     * Draws rejected STOMP frames from the protocol handler's decision, before
     * [org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator]
     * can buffer an ERROR and then drop it when the close follows immediately (#224).
     */
    fun installErrorDrawing(handler: WebSocketHandler) {
        val sub = WebSocketHandlerDecorator.unwrap(handler) as? SubProtocolWebSocketHandler ?: return
        val protocols = LinkedHashSet<StompSubProtocolHandler>()
        sub.protocolHandlerMap.values.filterIsInstanceTo(protocols)
        (sub.defaultProtocolHandler as? StompSubProtocolHandler)?.let(protocols::add)
        for (protocol in protocols) {
            val existing = protocol.errorHandler
            if (existing !is LsdStompErrorHandler) {
                protocol.setErrorHandler(LsdStompErrorHandler(existing))
            }
        }
    }

    /**
     * What the popup shows of an ERROR frame the app writes to the socket: its `message` header and
     * body. Null for any other frame.
     */
    fun error(message: WebSocketMessage<*>): Map<String, Any?>? {
        val text = (message as? TextMessage)?.payload ?: return null
        if (!text.startsWith("ERROR\n") && !text.startsWith("ERROR\r\n")) return null
        val lines = text.substringBefore('\u0000').lines()
        val blank = lines.indexOfFirst { it.isEmpty() }.takeIf { it > 0 } ?: lines.size
        val why = lines
            .subList(1, blank)
            .firstOrNull { it.startsWith("message:") }
            ?.substringAfter(':')
            ?.let(::unescape)
        val body = lines.drop(blank + 1).joinToString("\n")
        return linkedMapOf("message" to why, "body" to body(body)).filterValues { it != null }
    }

    /** A STOMP header value, unescaped. */
    private fun unescape(value: String): String =
        ESCAPE.replace(value) {
            when (val c = it.groupValues[1]) {
                "r" -> "\r"
                "n" -> "\n"
                "c" -> ":"
                else -> c
            }
        }

    private val ESCAPE = Regex("""\\(.)""")

    /** What the popup shows of a frame's body. */
    fun body(payload: Any?): Any? =
        when (payload) {
            is ByteArray -> if (payload.isEmpty()) null else WsDrawing.popup(payload)
            is String -> if (payload.isEmpty()) null else WsDrawing.popup(payload.toByteArray())
            else -> null
        }
}

/**
 * Draws an ERROR when the protocol handler decides to send one, before the socket write
 * that [org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator] may
 * drop if a close follows while another send (typically CONNECTED) still holds the flush
 * lock. Wraps the app's handler when it has one, otherwise Spring's default.
 */
internal class LsdStompErrorHandler(
    private val delegate: StompSubProtocolErrorHandler? = null,
) : StompSubProtocolErrorHandler() {
    override fun handleClientMessageProcessingError(
        clientMessage: Message<ByteArray>?,
        ex: Throwable,
    ): Message<ByteArray>? {
        val error =
            if (delegate != null) {
                delegate.handleClientMessageProcessingError(clientMessage, ex)
            } else {
                super.handleClientMessageProcessingError(clientMessage, ex)
            }
        draw(clientMessage, error)
        return error
    }

    override fun handleErrorMessageToClient(errorMessage: Message<ByteArray>): Message<ByteArray>? {
        val error =
            if (delegate != null) {
                delegate.handleErrorMessageToClient(errorMessage)
            } else {
                super.handleErrorMessageToClient(errorMessage)
            }
        draw(errorMessage, error)
        return error
    }

    private fun draw(
        sessionMessage: Message<*>?,
        error: Message<ByteArray>?,
    ) {
        guarded(Unit) {
            if (error == null) return@guarded
            val drawn = (sessionMessage?.let { Stomp.session(it) } ?: Stomp.session(error)) ?: return@guarded
            if (!drawn.noteError()) return@guarded
            val accessor = MessageHeaderAccessor.getAccessor(error, StompHeaderAccessor::class.java)
                ?: StompHeaderAccessor.wrap(error)
            val data = linkedMapOf("message" to accessor.message, "body" to Stomp.body(error.payload))
                .filterValues { it != null }
            drawn.drawing.arrow(drawn.app, drawn.call.caller, "ERROR", data.ifEmpty { null }, status = "error")
        }
    }
}

/** Puts the starter's interceptors on the broker's client channels. Ordered first, so it sees frames as they arrive. */
internal class LsdStompConfigurer(
    private val handler: ObjectProvider<SimpAnnotationMethodMessageHandler>,
) : WebSocketMessageBrokerConfigurer,
    Ordered {
    override fun getOrder(): Int = Ordered.HIGHEST_PRECEDENCE

    override fun configureClientInboundChannel(registration: ChannelRegistration) {
        registration.interceptors(LsdStompInbound(PayloadTypes(handler)))
    }

    override fun configureClientOutboundChannel(registration: ChannelRegistration) {
        registration.interceptors(LsdStompOutbound())
    }
}

/** Session, destination and body shared by inbound and outbound STOMP drawing. */
private class StompFrame(
    val drawn: DrawnSession,
    val headers: MessageHeaders,
    val destination: String?,
    val type: SimpMessageType?,
    val body: Any?,
)

private fun stompFrame(message: Message<*>): StompFrame? {
    val drawn = Stomp.session(message) ?: return null
    val headers = message.headers
    return StompFrame(
        drawn,
        headers,
        SimpMessageHeaderAccessor.getDestination(headers),
        SimpMessageHeaderAccessor.getMessageType(headers),
        Stomp.body(message.payload),
    )
}

/** Frames from the caller: drawn as they arrive; the app's handling of a SEND is drawn under it. */
internal class LsdStompInbound(
    private val types: PayloadTypes,
) : ExecutorChannelInterceptor {
    /** The span each recent SEND was drawn as, by message id, for the threads that handle it (see [beforeHandle]). */
    private val spans =
        object : LinkedHashMap<Any, SpringScenarios.Current>(64, 0.75f, false) {
            override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Any, SpringScenarios.Current>?): Boolean = size > MAX_IN_FLIGHT
        }
    private val previous = ThreadLocal<ArrayDeque<SpringScenarios.Current?>>()

    override fun preSend(
        message: Message<*>,
        channel: MessageChannel,
    ): Message<*> {
        guarded(Unit) { draw(message) }
        return message
    }

    private fun draw(message: Message<*>) {
        val frame = stompFrame(message) ?: return
        val (label, data) =
            when (frame.type) {
                SimpMessageType.SUBSCRIBE -> "SUBSCRIBE ${frame.destination}" to null
                SimpMessageType.UNSUBSCRIBE -> "UNSUBSCRIBE" to null
                SimpMessageType.MESSAGE -> "${types.of(frame.destination) ?: "SEND"} ${frame.destination}" to frame.body
                else -> return
            }
        val id = frame.drawn.drawing.arrow(frame.drawn.call.caller, frame.drawn.app, label, data) ?: return
        val messageId = frame.headers.id ?: return
        // Each of the channel's handlers (the app's methods, the broker) runs it on a thread of its own.
        synchronized(spans) { spans[messageId] = SpringScenarios.Current(frame.drawn.drawing.scenario, id) }
    }

    override fun beforeHandle(
        message: Message<*>,
        channel: MessageChannel,
        handler: MessageHandler,
    ): Message<*> {
        val stack = previous.get() ?: ArrayDeque<SpringScenarios.Current?>().also { previous.set(it) }
        stack.addLast(SpringScenarios.currentRaw())
        message.headers.id
            ?.let { synchronized(spans) { spans[it] } }
            ?.let { SpringScenarios.setCurrent(it) }
        return message
    }

    override fun afterMessageHandled(
        message: Message<*>,
        channel: MessageChannel,
        handler: MessageHandler,
        ex: Exception?,
    ) {
        val stack = previous.get()
        SpringScenarios.setCurrent(stack?.removeLastOrNull())
        if (stack.isNullOrEmpty()) previous.remove()
    }

    private companion object {
        const val MAX_IN_FLIGHT = 256
    }
}

/** Frames to the caller: the messages its subscriptions receive. ERROR frames are drawn by [LsdStompErrorHandler] and [DrawnSession]. */
internal class LsdStompOutbound : ExecutorChannelInterceptor {
    override fun preSend(
        message: Message<*>,
        channel: MessageChannel,
    ): Message<*> {
        guarded(Unit) { draw(message) }
        return message
    }

    private fun draw(message: Message<*>) {
        val frame = stompFrame(message) ?: return
        if (frame.type != SimpMessageType.MESSAGE) return
        val name = frame.headers[MessageNames.HEADER] as? String
        frame.drawn.drawing.arrow(
            frame.drawn.app,
            frame.drawn.call.caller,
            "${name ?: "MESSAGE"} ${frame.destination}",
            frame.body,
        )
    }
}

/**
 * The class a SEND's body becomes, from the `@MessageMapping` method its destination goes to: the
 * parameter marked `@Payload`, else the first that is not a header, destination variable, the
 * principal or the message itself. Null when no method takes it, or it takes a String or a Map.
 */
internal class PayloadTypes(
    private val handler: ObjectProvider<SimpAnnotationMethodMessageHandler>,
) {
    private val cache = ConcurrentHashMap<String, String>()

    fun of(destination: String?): String? =
        guarded(null) {
            if (destination == null) return@guarded null
            cache.getOrPut(destination) { find(destination) ?: NONE }.takeIf { it != NONE }
        }

    private fun find(destination: String): String? {
        val handler = handler.ifAvailable ?: return null
        val prefixes = handler.destinationPrefixes
        val lookup =
            if (prefixes.isEmpty()) {
                destination
            } else {
                prefixes.firstOrNull { destination.startsWith(it) }?.let { destination.substring(it.length - 1) } ?: return null
            }
        val probe =
            MessageBuilder
                .withPayload(ByteArray(0))
                .setHeader(DestinationPatternsMessageCondition.LOOKUP_DESTINATION_HEADER, lookup)
                .setHeader(SimpMessageHeaderAccessor.MESSAGE_TYPE_HEADER, SimpMessageType.MESSAGE)
                .setHeader(SimpMessageHeaderAccessor.DESTINATION_HEADER, destination)
                .build()
        val method = handler.handlerMethods.entries
            .firstOrNull { it.key.getMatchingCondition(probe) != null }
            ?.value ?: return null
        val parameters = method.methodParameters
        val payload = parameters.firstOrNull { it.hasParameterAnnotation(Payload::class.java) } ?: parameters.firstOrNull(::isBody)
        return payload?.parameterType?.let(MessageNames::nameOf)
    }

    private fun isBody(parameter: MethodParameter): Boolean {
        if (parameter.hasParameterAnnotation(Header::class.java)) return false
        if (parameter.hasParameterAnnotation(Headers::class.java)) return false
        if (parameter.hasParameterAnnotation(DestinationVariable::class.java)) return false
        val type = parameter.parameterType
        return listOf(Principal::class.java, Message::class.java, MessageHeaders::class.java, MessageHeaderAccessor::class.java)
            .none { it.isAssignableFrom(type) }
    }

    private companion object {
        const val NONE = "\u0000"
    }
}

/**
 * The app's broker message converter, which names the class each payload was written from in a
 * header of the message it writes ([MessageNames.HEADER]; not a STOMP header, so it never reaches
 * the wire). The simple broker copies it onto each subscriber's MESSAGE, which is labelled with it.
 */
internal class NamingMessageConverter(
    converters: Collection<MessageConverter>,
) : CompositeMessageConverter(converters) {
    override fun toMessage(
        payload: Any,
        headers: MessageHeaders?,
    ): Message<*>? = named(payload, super.toMessage(payload, headers))

    override fun toMessage(
        payload: Any,
        headers: MessageHeaders?,
        conversionHint: Any?,
    ): Message<*>? = named(payload, super.toMessage(payload, headers, conversionHint))

    private fun named(
        payload: Any,
        message: Message<*>?,
    ): Message<*>? {
        if (message == null) return null
        val name = guarded(null) { MessageNames.nameOf(payload.javaClass) } ?: return message
        val accessor = MessageHeaderAccessor.getMutableAccessor(message)
        accessor.setHeader(MessageNames.HEADER, name)
        return MessageBuilder.createMessage(message.payload, accessor.messageHeaders)
    }
}

/** Swaps the app's broker message converter for a [NamingMessageConverter] holding the same converters. */
internal class LsdStompPostProcessor : org.springframework.beans.factory.config.BeanPostProcessor {
    override fun postProcessAfterInitialization(
        bean: Any,
        beanName: String,
    ): Any {
        if (beanName != "brokerMessageConverter" || bean !is CompositeMessageConverter || bean is NamingMessageConverter) return bean
        return guarded(bean) { NamingMessageConverter(bean.converters) }
    }
}
