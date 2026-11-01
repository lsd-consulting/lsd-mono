package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.report.model.testing.Json
import io.github.lsdconsulting.lsd.mono.report.model.testing.JsonObject
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * A WebSocket server for tests that answers like LSD Studio's live endpoint: welcome to a hello,
 * stored to report.done (then close 1000). With [refuseVersion] it answers the hello with
 * unsupported-version and closes 4001. Text frames only; enough of RFC 6455 for the JDK client.
 */
internal class TestStudio(
    private val refuseVersion: Boolean = false,
) : AutoCloseable {
    private val server = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    val url: String = "ws://127.0.0.1:${server.localPort}/ws/captures"

    /** Every text frame received, on every connection, in order. */
    val frames: MutableList<String> = CopyOnWriteArrayList()
    val connections = AtomicInteger()
    private val closed = CountDownLatch(1)

    init {
        Thread({ accept() }, "test-studio").apply { isDaemon = true }.start()
    }

    /** Waits until a connection has ended. */
    fun awaitClosed(seconds: Long = 5): Boolean = closed.await(seconds, TimeUnit.SECONDS)

    private fun accept() {
        while (!server.isClosed) {
            val socket = runCatching { server.accept() }.getOrNull() ?: return
            connections.incrementAndGet()
            Thread({ socket.use { serve(it) } }, "test-studio-connection").apply { isDaemon = true }.start()
        }
    }

    private fun serve(socket: Socket) {
        try {
            val input = DataInputStream(socket.getInputStream())
            val output = socket.getOutputStream()
            handshake(input, output)
            val text = ByteArrayOutputStream()
            while (true) {
                val b0 = input.readUnsignedByte()
                val b1 = input.readUnsignedByte()
                var length = (b1 and 0x7F).toLong()
                if (length == 126L) length = input.readUnsignedShort().toLong()
                if (length == 127L) length = input.readLong()
                val mask = ByteArray(4).also { if (b1 and 0x80 != 0) input.readFully(it) }
                val payload = ByteArray(length.toInt()).also(input::readFully)
                for (i in payload.indices) payload[i] = (payload[i].toInt() xor mask[i % 4].toInt()).toByte()
                when (b0 and 0x0F) {
                    0x8 -> {
                        close(output, 1000)
                        return
                    }
                    0x1, 0x0 -> {
                        text.write(payload)
                        if (b0 and 0x80 != 0) {
                            val frame = text.toString(Charsets.UTF_8)
                            text.reset()
                            frames.add(frame)
                            if (!answer(output, Json.parse(frame) as JsonObject)) return
                        }
                    }
                }
            }
        } catch (_: Exception) {
            // The client went away.
        } finally {
            closed.countDown()
        }
    }

    /** Answers [frame]; false when the server closed the socket. */
    private fun answer(
        output: OutputStream,
        frame: JsonObject,
    ): Boolean {
        when (frame.string("type")) {
            "hello" ->
                if (refuseVersion) {
                    send(output, """{"type":"error","code":"unsupported-version","message":"This server speaks lsd-live 9.x."}""")
                    close(output, 4001)
                    return false
                } else {
                    send(output, """{"type":"welcome","protocol":"lsd-live","version":"0.1.0","reportId":"r1"}""")
                }
            "report.done" -> {
                send(output, """{"type":"stored","reportId":"r1"}""")
                close(output, 1000)
                return false
            }
        }
        return true
    }

    private fun handshake(
        input: DataInputStream,
        output: OutputStream,
    ) {
        var key = ""
        while (true) {
            val line = readLine(input)
            if (line.isEmpty()) break
            val (name, value) = line.split(":", limit = 2).let { it[0].trim() to it.getOrElse(1) { "" }.trim() }
            if (name.equals("Sec-WebSocket-Key", ignoreCase = true)) key = value
        }
        val accept =
            Base64.getEncoder().encodeToString(
                MessageDigest.getInstance("SHA-1").digest((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").toByteArray()),
            )
        output.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n\r\n".toByteArray())
        output.flush()
    }

    private fun readLine(input: DataInputStream): String {
        val line = StringBuilder()
        while (true) {
            val c = input.readUnsignedByte()
            if (c == '\n'.code) return line.toString().trimEnd('\r')
            line.append(c.toChar())
        }
    }

    private fun send(
        output: OutputStream,
        text: String,
    ) {
        val bytes = text.toByteArray()
        output.write(0x81)
        if (bytes.size < 126) {
            output.write(bytes.size)
        } else {
            output.write(126)
            output.write(bytes.size shr 8)
            output.write(bytes.size and 0xFF)
        }
        output.write(bytes)
        output.flush()
    }

    private fun close(
        output: OutputStream,
        code: Int,
    ) {
        output.write(byteArrayOf(0x88.toByte(), 2, (code shr 8).toByte(), (code and 0xFF).toByte()))
        output.flush()
    }

    override fun close() {
        server.close()
    }
}
