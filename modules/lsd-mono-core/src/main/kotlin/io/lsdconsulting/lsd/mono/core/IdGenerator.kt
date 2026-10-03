package io.lsdconsulting.lsd.mono.core

import java.util.UUID
import java.util.concurrent.atomic.AtomicInteger

class IdGenerator(isDeterministic: Boolean = false) {
    private val counter = AtomicInteger()
    private val idSupplier: () -> String =
        if (isDeterministic) {
            { counter.incrementAndGet().toString() }
        } else {
            { UUID.randomUUID().toString().replace("-", "") }
        }

    fun next(): String = idSupplier()

    fun reset() {
        counter.set(0)
    }
}
