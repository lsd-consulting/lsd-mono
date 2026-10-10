package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.domain.Message
import io.lsdconsulting.lsd.mono.core.domain.MessageType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class MessageVerbTest {
    private val lsd = LsdContext()

    private fun captured(verbs: LsdScenario.() -> Unit): List<Message> {
        val scenario = lsd.beginScenario(bindCurrentThread = false)
        scenario.verbs()
        return scenario.close().second.map { it as Message }
    }

    @Test
    fun `a message type in the data position is the type, not data`() {
        val message = captured { message("A", "B", "lost", MessageType.LOST) }.single()

        assertEquals(MessageType.LOST, message.type)
        assertNull(message.data)
    }

    @Test
    fun `data and then type still work`() {
        val message = captured { message("A", "B", "event", mapOf("id" to 1), MessageType.ASYNCHRONOUS) }.single()

        assertEquals(MessageType.ASYNCHRONOUS, message.type)
        assertEquals("{id=1}", message.data.toString(), "data is snapshotted")
    }

    @Test
    fun `named arguments pick the same message`() {
        val messages =
            captured {
                message("A", "B", "named", type = MessageType.BI_DIRECTIONAL)
                message("A", "B")
            }

        assertEquals(listOf(MessageType.BI_DIRECTIONAL, MessageType.SYNCHRONOUS), messages.map { it.type })
    }
}
