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
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Streams each report to LSD Studio as its tests run (live capture protocol v0), when
 * `lsd.mono.studio.url` is set. Off by default.
 *
 * A report gets its own socket: the hello when its first scenario begins, then each scenario
 * (start, events, end) when it completes, mapped as the written report maps it, and `report.done`
 * once the report file is written. It is best effort and never fails or holds up a test: frames
 * go through a bounded queue to one daemon thread, every network step has a short timeout, and
 * only `report.done` waits, for at most [flushTimeout]. The first problem (LSD Studio not
 * running, a refused version, a full queue) is warned about once; the stream it hit stops, and
 * if LSD Studio could not be reached at all, live capture is off for the rest of the run.
 */
internal class LiveCapture(
    private val frames: LiveFrames,
    private val url: () -> String?,
    private val connector: LiveConnector = JdkLiveConnector(),
    private val flushTimeout: Duration = Duration.ofSeconds(2),
    queueCapacity: Int = 10_000,
) {
    private val streams = ConcurrentHashMap<String, Stream>()
    private val titles = ConcurrentHashMap<String, String>()
    private val warned = AtomicBoolean()

    @Volatile
    private var unreachable = false

    private val worker =
        ThreadPoolExecutor(0, 1, 30, TimeUnit.SECONDS, LinkedBlockingQueue(queueCapacity)) { task ->
            Thread(task, "lsd-studio-live").apply { isDaemon = true }
        }

    /** The title [reportKey]'s report will have, for its hello. */
    fun title(
        reportKey: String?,
        title: String,
    ) = quietly { titles[key(reportKey)] = title }

    /** A scenario of [reportKey]'s report began: open its stream, if it has none. */
    fun begun(reportKey: String?) = quietly { stream(reportKey) }

    /** [scenario] of [reportKey]'s report completed. */
    fun completed(
        reportKey: String?,
        scenario: Scenario,
    ) = quietly { stream(reportKey)?.let { s -> s.submit { s.sendScenario(scenario) } } }

    /** [reportKey]'s report was written: finish its stream, waiting at most [flushTimeout]. */
    fun written(reportKey: String?) =
        quietly {
            titles.remove(key(reportKey))
            val stream = streams.remove(key(reportKey)) ?: return@quietly
            stream.submit { stream.finish() }
            stream.done.await(flushTimeout.toMillis(), TimeUnit.MILLISECONDS)
        }

    private fun stream(reportKey: String?): Stream? {
        if (unreachable) return null
        val target = url()?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        return streams.computeIfAbsent(key(reportKey)) { k ->
            Stream(target).also { s -> s.submit { s.open(titles[k]) } }
        }
    }

    private fun key(reportKey: String?): String = reportKey ?: ""

    private fun warnOnce(message: String) {
        if (warned.compareAndSet(false, true)) {
            logger.log(WARNING, "LSD: $message Tests and report files are not affected.")
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
        private var socket: LiveSocket? = null
        private val scenarioIds = AtomicInteger()

        @Volatile
        private var broken = false

        fun submit(task: () -> Unit) {
            try {
                worker.execute { if (!broken) guard(task) }
            } catch (_: RejectedExecutionException) {
                stop("LSD Studio is not keeping up with this test run, so its live report stops here.")
            }
        }

        fun open(title: String?) {
            val uri = URI.create(target)
            require(uri.scheme == "ws" || uri.scheme == "wss") { "$target is not a ws:// or wss:// URL" }
            socket =
                try {
                    connector.connect(uri, ::reply) { code ->
                        if (code != 1000) broken = true
                        done.countDown()
                    }
                } catch (e: Exception) {
                    unreachable = true
                    stop("could not reach LSD Studio at $target ($e), so live capture is off for this run.")
                    return
                }
            send(frames.hello(title))
        }

        fun sendScenario(scenario: Scenario) {
            frames.scenario(scenarioIds.incrementAndGet().toString(), scenario).forEach(::send)
        }

        fun finish() {
            send(LiveFrames.DONE)
            // The server answers stored and closes; done counts down then, or after the wait.
            if (!done.await(flushTimeout.toMillis(), TimeUnit.MILLISECONDS)) socket?.close()
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
                stop("live capture to LSD Studio at $target stopped ($e).")
            }
        }

        private fun stop(message: String) {
            broken = true
            done.countDown()
            warnOnce(message)
            socket?.let { s -> runCatching { s.close() } }
        }
    }

    private companion object {
        val logger: System.Logger = System.getLogger(LsdContext::class.java.name)
    }
}
