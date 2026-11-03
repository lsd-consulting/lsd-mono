package io.github.lsdconsulting.lsd.mono.jvm.live

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.domain.Scenario
import java.lang.System.Logger.Level.WARNING
import java.net.URI
import java.time.Duration
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Streams each report to LSD Studio as its tests run (live capture protocol v0), when
 * `lsd.mono.studio.url` is set. Off by default.
 *
 * A report gets its own socket: the hello when its first scenario begins, then each scenario
 * (start, events, end), mapped as the written report maps it, and `report.done` once the report
 * file is written. A scenario whose title is known when it begins ([started]) is sent as it runs:
 * its start and each event once it has settled, then the rest and its end when it completes (see
 * [Running]). Any other scenario is sent whole when it completes. It is best effort and never fails or holds up a test: frames
 * go through a bounded queue to one daemon thread, every network step has a short timeout, and
 * only `report.done` waits, for at most [flushTimeout]. The first problem (LSD Studio not
 * running, a refused version, a full queue) is warned about once; the stream it hit stops, and
 * if LSD Studio could not be reached or anything timed out, live capture is off for the rest of
 * the run, so a stalled LSD Studio costs at most one wait.
 */
internal class LiveCapture(
    private val frames: LiveFrames,
    private val url: () -> String?,
    private val connector: LiveConnector = JdkLiveConnector(),
    private val flushTimeout: Duration = Duration.ofSeconds(2),
    queueCapacity: Int = 10_000,
    keepAlive: Duration = Duration.ofSeconds(30),
    private val warn: (String) -> Unit = { message -> logger.log(WARNING, message) },
) {
    private val streams = ConcurrentHashMap<String, Stream>()
    private val titles = ConcurrentHashMap<String, String>()
    private val running = ConcurrentHashMap<Any, Stream.Running>()

    /** How many scenarios are being sent as they run: each leaves when it completes, is discarded, or its stream ends. */
    internal val runningCount: Int get() = running.size
    private val warned = AtomicBoolean()

    /** Live capture is off for the rest of the run: LSD Studio could not be reached, or timed out. */
    @Volatile
    internal var off = false
        private set

    private val worker =
        ThreadPoolExecutor(0, 1, keepAlive.toMillis(), TimeUnit.MILLISECONDS, LinkedBlockingQueue(queueCapacity)) { task ->
            Thread(task, "lsd-studio-live").apply { isDaemon = true }
        }

    /** The worker threads now and at most, for tests: none until a stream opens, and none once idle. */
    internal val workerThreads get() = worker.poolSize
    internal val mostWorkerThreads get() = worker.largestPoolSize

    /** The title [reportKey]'s report will have, for its hello. */
    fun title(
        reportKey: String?,
        title: String,
    ) = quietly { titles[key(reportKey)] = title }

    /** A scenario of [reportKey]'s report began: open its stream, if it has none. */
    fun begun(reportKey: String?) = quietly { stream(reportKey) }

    /**
     * [scenario] of [reportKey]'s report began, titled [title]: send it as it runs. [snapshot] maps
     * what it has captured so far as its report would (null once it has completed); it is called
     * on the worker thread.
     */
    fun started(
        reportKey: String?,
        scenario: Any,
        title: String,
        snapshot: (title: String) -> Scenario?,
    ) = quietly {
        val stream = stream(reportKey) ?: return@quietly
        running.computeIfAbsent(scenario) { stream.Running(title, snapshot) }
        // The stream may have stopped, or its report been written, since stream() returned it; its
        // forget() then ran before this add. Both flags are set before forget(), so checking them
        // after the add catches every order.
        if (stream.broken || stream.closed) stream.forget()
    }

    /** [scenario] captured more: send what has settled, soon, on the worker thread. */
    fun captured(scenario: Any) = quietly { running[scenario]?.changed() }

    /** [scenario] of [reportKey]'s report completed, as [stored]. */
    fun completed(
        reportKey: String?,
        stored: Scenario,
        scenario: Any? = null,
    ) = quietly {
        val live = scenario?.let(running::remove)
        if (live != null) {
            live.stream.submit { live.complete(stored) }
        } else {
            stream(reportKey)?.let { s -> s.submit { s.sendScenario(stored) } }
        }
    }

    /** [scenario] was discarded: it is not in the report file, so a live view of it ends saying so. */
    fun discarded(scenario: Any) = quietly { running.remove(scenario)?.let { live -> live.stream.submit { live.discard() } } }

    /** [reportKey]'s report was written: finish its stream, waiting at most [flushTimeout]. */
    fun written(reportKey: String?) =
        quietly {
            titles.remove(key(reportKey))
            val stream = streams.remove(key(reportKey)) ?: return@quietly
            // A scenario that began but never completed (its adapter failed, say) goes with its report.
            stream.closed = true
            stream.forget()
            stream.submit { stream.finish() }
            if (!stream.done.await(flushTimeout.toMillis(), TimeUnit.MILLISECONDS)) {
                off = true
                warnOnce("LSD Studio did not answer in time, so live capture is off for this run.")
            }
        }

    private fun stream(reportKey: String?): Stream? {
        if (off) return null
        val target = url()?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return streams.computeIfAbsent(key(reportKey)) { k ->
            // The title is read here, on the test's thread, before a later title() can change it.
            val title = titles[k]
            Stream(target).also { s -> s.submit { s.open(title) } }
        }
    }

    private fun key(reportKey: String?): String = reportKey ?: ""

    private fun warnOnce(message: String) {
        if (warned.compareAndSet(false, true)) {
            warn("LSD: $message Tests and report files are not affected.")
        }
    }

    private fun quietly(block: () -> Unit) {
        try {
            block()
        } catch (e: VirtualMachineError) {
            throw e
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (e: Throwable) {
            warnOnce("live capture to LSD Studio failed ($e).")
        }
    }

    /** One report's socket. Everything but [submit] and [done] runs on the worker thread. */
    private inner class Stream(
        private val target: String,
    ) {
        val done = CountDownLatch(1)

        @Volatile
        private var socket: LiveSocket? = null
        private val scenarioIds = AtomicInteger()

        /** The stream stopped: set before [forget], see [started]. */
        @Volatile
        var broken = false
            private set

        /** Its report was written: set before [forget], see [started]. */
        @Volatile
        var closed = false

        fun submit(task: () -> Unit) {
            try {
                worker.execute { if (!broken) guard(task) }
            } catch (_: RejectedExecutionException) {
                // On the test's thread: drop the socket rather than wait for a clean close.
                stop("LSD Studio is not keeping up with this test run, so its live report stops here.", abort = true)
            }
        }

        fun open(title: String?) {
            val uri = URI.create(target)
            require(uri.scheme == "ws" || uri.scheme == "wss") { "$target is not a ws:// or wss:// URL" }
            socket =
                try {
                    connector.connect(uri, ::reply) { code ->
                        if (code != 1000) broken = true
                        forget()
                        done.countDown()
                    }
                } catch (e: Exception) {
                    off = true
                    stop("could not reach LSD Studio at $target ($e), so live capture is off for this run.")
                    return
                }
            send(frames.hello(title))
        }

        fun sendScenario(scenario: Scenario) {
            frames.scenario(scenarioIds.incrementAndGet().toString(), scenario).forEach(::send)
        }

        /**
         * A scenario sent as it runs. Its report maps events again as later ones arrive (a call's
         * duration and pairing come from its reply, the clock can order events again, and its
         * participants are the ones its events use), so only settled events are sent: those before
         * the first call that has no reply yet, mapped as the report would map them so far. The
         * start goes with the first of them, so it lists the participants they use. On completion
         * the rest follow, and if the report's own mapping no longer begins with what was sent, or
         * its title differs, a sender error says so. A participant first named after the start is
         * one LSD Studio adds by its id, as protocol v0 has no way to declare it later. All but
         * [changed] runs on the worker thread.
         */
        inner class Running(
            private val title: String,
            private val snapshot: (String) -> Scenario?,
        ) {
            val stream: Stream get() = this@Stream
            private val id = scenarioIds.incrementAndGet().toString()
            private val pending = AtomicBoolean()
            private var start: LiveScenario? = null
            private val sent = ArrayList<LiveEvent>()
            private var differs = false

            /** Something was captured: one flush is queued at a time, and it sends all that has settled. */
            fun changed() {
                if (pending.compareAndSet(false, true)) submit { flush() }
            }

            private fun flush() {
                pending.set(false)
                if (differs) return
                val now = frames.parts(id, snapshot(title) ?: return)
                val settled = settled(now.events)
                if (settled == 0 && start == null) return
                if (sent.indices.any { i -> now.events.getOrNull(i)?.frame != sent[i].frame }) {
                    differs = true
                    return
                }
                if (start == null) {
                    start = now
                    send(now.start)
                }
                for (event in now.events.subList(sent.size.coerceAtMost(settled), settled)) {
                    send(event.frame)
                    sent.add(event)
                }
            }

            fun complete(stored: Scenario) {
                val final = frames.parts(id, stored)
                val shown = start
                if (shown == null) {
                    send(final.start)
                    final.events.forEach { send(it.frame) }
                    send(final.end)
                    return
                }
                val agrees = !differs && final.events.take(sent.size).map(LiveEvent::frame) == sent.map(LiveEvent::frame)
                val rest = if (agrees) final.events.drop(sent.size) else final.events.filter { e -> sent.none { it.id == e.id } }
                rest.forEach { send(it.frame) }
                if (!agrees || final.title != shown.title) {
                    send(frames.error(id, LiveFrames.DIFFERS))
                }
                send(final.end)
            }

            fun discard() {
                if (start != null) send(frames.discarded(id))
            }

            /** The events before the first call with no reply. */
            private fun settled(events: List<LiveEvent>): Int {
                val answered = events.mapNotNullTo(HashSet()) { it.replyTo }
                val open = events.indexOfFirst { it.call && it.id !in answered }
                return if (open < 0) events.size else open
            }
        }

        fun finish() {
            send(LiveFrames.DONE)
            // The server answers stored and closes; done counts down then, or after the wait.
            if (!done.await(flushTimeout.toMillis(), TimeUnit.MILLISECONDS)) {
                off = true
                stop("LSD Studio at $target did not answer in time, so live capture is off for this run.")
            }
        }

        private fun send(frame: String) {
            if (broken) return
            checkNotNull(socket).send(frame)
        }

        private fun reply(text: String) {
            val reply = LiveJson.members(LiveJson.compact(text))
            when (reply["type"]) {
                "\"stored\"" -> done.countDown()
                "\"error\"" ->
                    when (reply["code"]) {
                        "\"unsupported-version\"", "\"hello-required\"" ->
                            stop("LSD Studio at $target refused this sender's protocol version ${LiveFrames.VERSION} (${reply["message"]}).")
                        else -> warnOnce("LSD Studio at $target refused a message: ${reply["message"]}.")
                    }
            }
        }

        private fun guard(task: () -> Unit) {
            try {
                task()
            } catch (e: VirtualMachineError) {
                throw e
            } catch (e: Throwable) {
                if (timedOut(e)) {
                    off = true
                    stop("LSD Studio at $target timed out, so live capture is off for this run.")
                } else {
                    stop("live capture to LSD Studio at $target stopped ($e).")
                }
            }
        }

        /** Drops this stream's running scenarios, so nothing holds on to their events. */
        fun forget() {
            running.values.removeIf { it.stream === this }
        }

        private fun timedOut(e: Throwable): Boolean = generateSequence(e) { it.cause }.take(10).any { it is TimeoutException }

        private fun stop(
            message: String,
            abort: Boolean = false,
        ) {
            broken = true
            forget()
            warnOnce(message)
            done.countDown()
            socket?.let { s -> runCatching { if (abort) s.abort() else s.close() } }
        }
    }

    private companion object {
        val logger: System.Logger = System.getLogger(LsdContext::class.java.name)
    }
}
