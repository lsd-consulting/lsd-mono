package io.github.lsdconsulting.lsd.mono.jvm.live

import java.net.URI
import java.net.http.HttpClient
import java.net.http.WebSocket
import java.time.Duration
import java.util.concurrent.CompletionStage
import java.util.concurrent.TimeUnit

/**
 * One open WebSocket to LSD Studio. [send] blocks until the frame is sent or fails; [close] waits
 * briefly for a clean close; [abort] drops the connection at once, without blocking.
 */
internal interface LiveSocket {
    fun send(text: String)

    fun close()

    fun abort()
}

/** Opens a [LiveSocket]; [onText] gets each whole text frame the server sends, [onClose] its close code. */
internal fun interface LiveConnector {
    fun connect(
        uri: URI,
        onText: (String) -> Unit,
        onClose: (Int) -> Unit,
    ): LiveSocket
}

/** The JDK's WebSocket client (java.net.http): no dependency. Every step is bounded by [timeout]. */
internal class JdkLiveConnector(
    private val timeout: Duration = Duration.ofSeconds(2),
) : LiveConnector {
    private val client: HttpClient by lazy { HttpClient.newBuilder().connectTimeout(timeout).build() }

    override fun connect(
        uri: URI,
        onText: (String) -> Unit,
        onClose: (Int) -> Unit,
    ): LiveSocket {
        val listener =
            object : WebSocket.Listener {
                private val text = StringBuilder()

                override fun onText(
                    webSocket: WebSocket,
                    data: CharSequence,
                    last: Boolean,
                ): CompletionStage<*>? {
                    text.append(data)
                    if (last) {
                        val frame = text.toString()
                        text.setLength(0)
                        onText(frame)
                    }
                    webSocket.request(1)
                    return null
                }

                override fun onClose(
                    webSocket: WebSocket,
                    statusCode: Int,
                    reason: String,
                ): CompletionStage<*>? {
                    onClose(statusCode)
                    return null
                }

                override fun onError(
                    webSocket: WebSocket,
                    error: Throwable,
                ) {
                    onClose(-1)
                }
            }
        val socket =
            client
                .newWebSocketBuilder()
                .connectTimeout(timeout)
                .buildAsync(uri, listener)
                .get(timeout.toMillis(), TimeUnit.MILLISECONDS)
        return object : LiveSocket {
            override fun send(text: String) {
                socket.sendText(text, true).get(timeout.toMillis(), TimeUnit.MILLISECONDS)
            }

            override fun close() {
                try {
                    socket.sendClose(WebSocket.NORMAL_CLOSURE, "").get(timeout.toMillis(), TimeUnit.MILLISECONDS)
                } catch (_: Exception) {
                    socket.abort()
                }
            }

            override fun abort() = socket.abort()
        }
    }
}
