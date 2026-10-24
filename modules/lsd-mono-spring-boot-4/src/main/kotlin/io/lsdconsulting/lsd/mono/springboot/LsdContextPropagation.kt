package io.lsdconsulting.lsd.mono.springboot

import io.micrometer.context.ContextRegistry
import io.micrometer.context.ThreadLocalAccessor
import reactor.core.publisher.Hooks

/**
 * Carries the request a reactive chain serves onto every thread the chain hops to, so the
 * repository calls and Kafka sends it makes there (which read the thread, not Reactor's context)
 * nest under the right request even while the scenario serves several at once.
 *
 * It registers a Micrometer context-propagation [ThreadLocalAccessor] for the key [LsdWebFilter]
 * writes into Reactor's context, and turns on Reactor's automatic context propagation, as Spring
 * Boot's `spring.reactor.context-propagation=auto` does. Both are JVM-wide and idempotent; the
 * accessor carries nothing unless a test scenario is running.
 */
internal object LsdContextPropagation {
    @Volatile private var installed = false

    fun install() {
        if (installed) return
        synchronized(this) {
            if (installed) return
            ContextRegistry.getInstance().registerThreadLocalAccessor(Accessor)
            Hooks.enableAutomaticContextPropagation()
            installed = true
        }
    }

    /** Undoes [install]; for tests that check what happens without it. */
    fun uninstall() {
        synchronized(this) {
            if (!installed) return
            Hooks.disableAutomaticContextPropagation()
            ContextRegistry.getInstance().removeThreadLocalAccessor(LsdReactor.KEY)
            installed = false
        }
    }

    /** Between Reactor's context and [SpringScenarios]'s thread-local; only running scenarios cross. */
    object Accessor : ThreadLocalAccessor<SpringScenarios.Current> {
        override fun key(): Any = LsdReactor.KEY

        override fun getValue(): SpringScenarios.Current? = SpringScenarios.current()

        override fun setValue(value: SpringScenarios.Current) {
            SpringScenarios.setCurrent(value.takeIf { SpringScenarios.isRunning(it.scenario) })
        }

        override fun setValue() {
            SpringScenarios.setCurrent(null)
        }

        override fun restore(previousValue: SpringScenarios.Current) {
            SpringScenarios.setCurrent(previousValue)
        }

        override fun restore() {
            SpringScenarios.setCurrent(null)
        }
    }
}
