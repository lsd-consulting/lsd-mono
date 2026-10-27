package io.github.lsdconsulting.lsd.mono.ktor

import io.github.lsdconsulting.lsd.mono.ktor.Calls.guarded
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.readReason
import kotlinx.coroutines.channels.ChannelIterator
import kotlinx.coroutines.channels.ChannelResult
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.channels.SendChannel
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.cancellation.CancellationException

/**
 * Draws the frames that pass one end of a WebSocket, [local], to and from [remote]: text and
 * binary messages, the close from whichever side sent it first, and an error that ends it. Pings
 * and pongs are left out. A message sent in fragments is drawn once, from its first fragment.
 */
internal class WsTap(
    val drawing: WsDrawing,
    private val local: String,
    private val remote: String,
) {
    /** The last message in, so a call the app makes in answer nests under it. */
    @Volatile var lastIn: String? = null

    private val fragmentsIn = AtomicBoolean()
    private val fragmentsOut = AtomicBoolean()

    fun inbound(frame: Frame) {
        seen(frame, remote, local, fragmentsIn)?.let { lastIn = it }
    }

    fun outbound(frame: Frame) {
        seen(frame, local, remote, fragmentsOut)
    }

    private fun seen(
        frame: Frame,
        from: String,
        to: String,
        fragments: AtomicBoolean,
    ): String? =
        guarded(null) {
            when (frame) {
                is Frame.Close -> {
                    drawing.close(from, to, frame.readReason())
                    null
                }
                is Frame.Text, is Frame.Binary -> {
                    // A later fragment of a message already drawn from its first.
                    if (fragments.getAndSet(!frame.fin)) return@guarded null
                    when {
                        !frame.fin -> drawing.message(from, to, frame, "sent in fragments")
                        frame.rsv1 -> drawing.message(from, to, frame, "compressed")
                        else -> drawing.message(from, to, frame)
                    }
                }
                else -> null
            }
        }

    /**
     * The app's handler failed, and Ktor drops the socket without a close frame: drawn from the
     * app, unless it was only the socket closing under it.
     */
    fun failed(e: Throwable) {
        if (drawing.isClosed || quiet(e)) return
        drawing.error(local, remote, e)
        drawing.close(local, remote, DROPPED)
    }

    /**
     * Nothing more comes in. Without a close frame either way the socket was dropped: drawn as an
     * abnormal close from [remote], after the failure that dropped it, if there was one.
     */
    fun ended(cause: Throwable?) {
        if (drawing.isClosed) return
        if (cause != null && !quiet(cause)) drawing.error(remote, local, cause)
        drawing.close(remote, local, DROPPED)
    }

    private fun quiet(e: Throwable): Boolean = e is CancellationException || e is ClosedReceiveChannelException

    /** [raw] with every frame in and out drawn by this tap. */
    fun wrap(raw: WebSocketSession): WebSocketSession = TappedSession(raw, this)

    private companion object {
        /** 1006, the code for a socket that ended without a close frame; never sent, only drawn. */
        val DROPPED = CloseReason(1006.toShort(), "closed without a close frame")
    }
}

private class TappedSession(
    private val raw: WebSocketSession,
    tap: WsTap,
) : WebSocketSession by raw {
    override val incoming: ReceiveChannel<Frame> = TappedIncoming(raw.incoming, tap)
    override val outgoing: SendChannel<Frame> = TappedOutgoing(raw.outgoing, tap)

    override suspend fun send(frame: Frame) = outgoing.send(frame)
}

private class TappedOutgoing(
    private val channel: SendChannel<Frame>,
    private val tap: WsTap,
) : SendChannel<Frame> by channel {
    // Drawn as it is sent, so an answer that comes straight back is drawn after it.
    override suspend fun send(element: Frame) {
        tap.outbound(element)
        channel.send(element)
    }

    override fun trySend(element: Frame): ChannelResult<Unit> = channel.trySend(element).also { if (it.isSuccess) tap.outbound(element) }
}

private class TappedIncoming(
    private val channel: ReceiveChannel<Frame>,
    private val tap: WsTap,
) : ReceiveChannel<Frame> by channel {
    override suspend fun receive(): Frame =
        try {
            channel.receive().also { tap.inbound(it) }
        } catch (e: Throwable) {
            tap.ended(e.takeUnless { it is ClosedReceiveChannelException } ?: e.cause)
            throw e
        }

    override suspend fun receiveCatching(): ChannelResult<Frame> =
        channel.receiveCatching().also { result ->
            result.getOrNull()?.let { tap.inbound(it) }
            if (result.isClosed) tap.ended(result.exceptionOrNull())
        }

    override fun tryReceive(): ChannelResult<Frame> =
        channel.tryReceive().also { result ->
            result.getOrNull()?.let { tap.inbound(it) }
            if (result.isClosed) tap.ended(result.exceptionOrNull())
        }

    override fun iterator(): ChannelIterator<Frame> {
        val frames = channel.iterator()
        return object : ChannelIterator<Frame> {
            override suspend fun hasNext(): Boolean =
                try {
                    frames.hasNext().also { if (!it) tap.ended(null) }
                } catch (e: Throwable) {
                    tap.ended(e)
                    throw e
                }

            override fun next(): Frame = frames.next().also { tap.inbound(it) }
        }
    }
}
