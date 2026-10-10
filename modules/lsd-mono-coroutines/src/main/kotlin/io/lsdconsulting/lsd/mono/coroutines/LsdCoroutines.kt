package io.lsdconsulting.lsd.mono.coroutines

import io.lsdconsulting.lsd.mono.core.LsdBinding
import io.lsdconsulting.lsd.mono.core.LsdScenario
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ThreadContextElement
import kotlinx.coroutines.withContext
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/**
 * A coroutine context element that keeps this scenario bound to whichever thread the
 * coroutine is running on.
 *
 * [LsdScenario.bind] and `LsdContext.scenario { }` bind a *thread*. A coroutine that
 * suspends and resumes on another dispatcher thread leaves that binding behind, so
 * captures through `LsdContext` after the hop go to the wrong scenario, or to none.
 * With this element in the coroutine's context, every thread the coroutine resumes on is
 * bound to the scenario for as long as the coroutine runs there, and is put back as it
 * found it when the coroutine suspends or ends.
 *
 * ```kotlin
 * val scenario = lsd.beginScenario(reportKey = "orders", bindCurrentThread = false)
 * withContext(scenario.asContextElement()) {
 *     lsd.message("Client", "Orders", "POST /orders")
 *     withContext(Dispatchers.IO) {
 *         lsd.message("Orders", "Db", "insert")   // still this scenario
 *     }
 * }
 * scenario.complete("Place an order")
 * ```
 *
 * Child coroutines inherit the element, so `launch { }` and `async { }` inside capture
 * into the same scenario. A nested element for another scenario shadows this one until it
 * ends. To make the scenario current for a block, use [withLsdScenario].
 *
 * The element only changes thread bindings. It does not complete the scenario.
 */
public fun LsdScenario.asContextElement(): ThreadContextElement<LsdBinding> = LsdScenarioElement(this)

/**
 * Run [block] with [scenario] bound to every thread the block's coroutine runs on, as if it
 * were wrapped in `withContext(scenario.asContextElement())`. Returns what [block] returns.
 * The thread bindings are restored whether the block returns, throws or is cancelled.
 *
 * It does not complete the scenario; call [LsdScenario.complete] when the work is done.
 */
public suspend fun <T> withLsdScenario(
    scenario: LsdScenario,
    block: suspend CoroutineScope.() -> T,
): T = withContext(scenario.asContextElement(), block)

/**
 * Binds the scenario each time the coroutine resumes on a thread, and closes that
 * [LsdBinding] when it leaves the thread. The coroutines library calls both on the same
 * thread, which is what [LsdBinding.close] needs to restore the previous binding.
 * All elements of this type share one [Key], so a nested one replaces the outer.
 */
private class LsdScenarioElement(
    private val scenario: LsdScenario,
) : AbstractCoroutineContextElement(Key),
    ThreadContextElement<LsdBinding> {
    override fun updateThreadContext(context: CoroutineContext): LsdBinding = scenario.bind()

    override fun restoreThreadContext(
        context: CoroutineContext,
        oldState: LsdBinding,
    ) {
        oldState.close()
    }

    override fun toString(): String = "LsdScenarioElement(${scenario.key})"

    companion object Key : CoroutineContext.Key<LsdScenarioElement>
}
