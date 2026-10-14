package io.lsdconsulting.lsd.mono.core

import io.lsdconsulting.lsd.mono.core.properties.LsdProperties
import java.lang.ref.WeakReference

/**
 * What a thread is bound to. [Own] was bound on this thread ([LsdContext.beginScenario],
 * [LsdScenario.bind]); [Inherited] came from the thread that created this one.
 */
internal sealed class ThreadBinding {
    abstract val scenario: LsdScenario?

    class Own(override val scenario: LsdScenario) : ThreadBinding()

    /**
     * Weak, so a long-lived thread that inherited a binding does not keep a finished
     * scenario and its captures in memory.
     */
    class Inherited(private val ref: WeakReference<LsdScenario>) : ThreadBinding() {
        override val scenario: LsdScenario? get() = ref.get()
    }
}

/**
 * The thread bindings of one [LsdContext]. A thread started while its creator is bound
 * inherits that scenario, like an `InheritableThreadLocal`, so `thread { lsd.message(...) }`
 * in a test lands in the test's scenario. An inherited binding is weaker than one made on
 * the thread itself, and it is ignored:
 * - once the inherited scenario has ended, so a thread that outlives its test goes back to
 *   the usual rules;
 * - on executor and pool worker threads (see [isPoolWorker]). A pool thread is created by
 *   whichever task happens to need it and is then reused for other work, possibly from
 *   other tests. Use [LsdContext.wrap] or [LsdScenario.bind] there;
 * - when `lsd.mono.scenario.inheritBinding` is `false` (then nothing is inherited).
 *
 * Virtual threads from `Executors.newVirtualThreadPerTaskExecutor()` are one thread per task,
 * created by the submitting thread, so they inherit the submitter's scenario, as they should.
 */
internal class ThreadBindings {
    private val binding =
        object : InheritableThreadLocal<ThreadBinding?>() {
            override fun childValue(parent: ThreadBinding?): ThreadBinding? {
                if (parent == null || !LsdProperties.inheritBinding()) return null
                return when (parent) {
                    is ThreadBinding.Own -> ThreadBinding.Inherited(WeakReference(parent.scenario))
                    is ThreadBinding.Inherited -> parent
                }
            }
        }

    /** The scenario this thread is bound to, own or (when allowed here) inherited. */
    fun get(): LsdScenario? =
        when (val b = binding.get()) {
            null -> null
            is ThreadBinding.Own -> b.scenario
            is ThreadBinding.Inherited -> if (isPoolWorker()) null else b.scenario
        }

    /** The scenario bound on this thread itself, ignoring anything inherited. */
    fun own(): LsdScenario? = (binding.get() as? ThreadBinding.Own)?.scenario

    /** Bind this thread to [scenario]; the returned function restores the previous binding. */
    fun set(scenario: LsdScenario): () -> Unit {
        val previous = binding.get()
        binding.set(ThreadBinding.Own(scenario))
        return { if (previous == null) binding.remove() else binding.set(previous) }
    }

    /** Forget this thread's binding when it is (or inherited) [scenario]. */
    fun forget(scenario: LsdScenario) {
        if (binding.get()?.scenario === scenario) binding.remove()
    }

    fun remove() = binding.remove()

    companion object {
        private val poolWorker = ThreadLocal<Boolean>()

        /**
         * Frames that mark a thread as a pool worker: the JDK's ThreadPoolExecutor (also
         * behind Executors.newFixed/Cached/Scheduled… and Tomcat's subclass), ForkJoinPool
         * (common pool, parallel streams, CompletableFuture's default executor), the
         * kotlinx.coroutines scheduler, Netty event loops and Jetty's QueuedThreadPool.
         */
        private val poolFrames: List<(String, String) -> Boolean> =
            listOf(
                { cls, method -> cls.endsWith("ThreadPoolExecutor") && method == "runWorker" },
                { cls, _ -> cls == "java.util.concurrent.ForkJoinWorkerThread" },
                { cls, _ -> cls.startsWith("kotlinx.coroutines.scheduling.CoroutineScheduler\$Worker") },
                { cls, _ -> cls.startsWith("io.netty.util.concurrent.SingleThreadEventExecutor") },
                { cls, _ -> cls.startsWith("org.eclipse.jetty.util.thread.QueuedThreadPool") },
            )

        /** Whether this thread runs a pool's worker loop. A thread's base frames never change, so it is worked out once. */
        fun isPoolWorker(): Boolean =
            poolWorker.get() ?: StackWalker
                .getInstance()
                .walk { frames -> frames.anyMatch { f -> poolFrames.any { it(f.className, f.methodName) } } }
                .also { poolWorker.set(it) }
    }
}
