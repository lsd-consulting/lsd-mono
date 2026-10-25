package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.LsdContext
import io.lsdconsulting.lsd.mono.core.LsdScenario
import io.lsdconsulting.lsd.mono.core.testing.LsdTestConfig
import io.lsdconsulting.lsd.mono.core.testing.ReportJson
import io.lsdconsulting.lsd.mono.core.testing.ScenarioJson
import jakarta.servlet.FilterChain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.aop.framework.ProxyFactory
import org.springframework.core.task.SimpleAsyncTaskExecutor
import org.springframework.core.task.TaskDecorator
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Work handed to a Spring-managed executor keeps its scenario and the request that handed it over. */
@LsdTestConfig(deterministicIds = true)
class LsdExecutorPropagationTest {
    private val names = ParticipantNames(MockEnvironment().withProperty("spring.application.name", "shop"))
    private val inbound = LsdInboundFilter(names)
    private val started = mutableListOf<LsdScenario>()
    private val pools = mutableListOf<AutoCloseable>()

    /** The server's request threads. */
    private val servers = Executors.newFixedThreadPool(2)

    fun interface Orders {
        fun save(sku: String): String
    }

    private val orders =
        ProxyFactory(Orders { it.uppercase() })
            .apply { addAdvice(LsdRepositoryInterceptor(Orders::class.java) { names }) }
            .proxy as Orders

    @BeforeEach
    @AfterEach
    fun clear() {
        pools.forEach(AutoCloseable::close)
        pools.clear()
        started.forEach(SpringScenarios::finished)
        started.clear()
        LsdContext.instance.clear()
    }

    @AfterEach
    fun stopServers() {
        servers.shutdownNow()
    }

    private fun start(
        key: String = "executor-test",
        bind: Boolean = true,
    ): LsdScenario =
        LsdContext.instance.beginScenario(reportKey = key, key = key, bindCurrentThread = bind).also {
            SpringScenarios.started(it)
            started += it
        }

    private fun report(
        scenario: LsdScenario,
        key: String = "executor-test",
    ): ScenarioJson {
        SpringScenarios.finished(scenario)
        scenario.complete(key)
        return ReportJson.read(LsdContext.instance.completeReport(key, key).reportJson).scenario(key)
    }

    /** A pool as the app declares it, put through the starter's post-processor as Spring would. */
    private fun pool(own: TaskDecorator? = null): ThreadPoolTaskExecutor =
        ThreadPoolTaskExecutor().apply {
            corePoolSize = 2
            setThreadNamePrefix("orders-")
            own?.let(::setTaskDecorator)
            LsdExecutorPostProcessor().postProcessBeforeInitialization(this, "orders")
            initialize()
            pools += AutoCloseable { shutdown() }
        }

    /** POST /orders/[sku] through the servlet filter, on its own thread, saving the order on [pool]. */
    private fun order(
        sku: String,
        pool: org.springframework.core.task.AsyncTaskExecutor,
        bothIn: CyclicBarrier,
        scenario: LsdScenario,
        onPool: () -> Unit = {},
    ): CompletableFuture<Unit> =
        CompletableFuture.supplyAsync({
            val request = MockHttpServletRequest("POST", "/orders/$sku")
            request.addHeader(io.lsdconsulting.lsd.mono.core.LsdHeaders.SCENARIO, scenario.correlationId)
            inbound.doFilter(
                request,
                MockHttpServletResponse(),
                FilterChain { _, response ->
                    // Both requests are being served before either hands its work over.
                    bothIn.await(5, TimeUnit.SECONDS)
                    pool.submit { onPool().also { orders.save(sku) } }.get(5, TimeUnit.SECONDS)
                    (response as jakarta.servlet.http.HttpServletResponse).status = 201
                },
            )
        }, servers)

    private fun assertNested(
        drawn: ScenarioJson,
        vararg skus: String,
    ) {
        for (sku in skus) {
            val request = drawn.message("POST /orders/$sku")
            val save = drawn.message("save(\"$sku\")")
            assertEquals("shop", save["from"], "$sku's save is the app's: ${drawn.json}")
            assertEquals(request["callId"], save.obj("trace")?.get("parentSpanId"), "$sku's save nests under its own request: ${drawn.json}")
        }
    }

    @Test
    fun `two requests served at once each keep the work they hand to a pool`() {
        val scenario = start()
        val pool = pool()
        val bothIn = CyclicBarrier(2)

        listOf("lamp-01", "desk-02").map { order(it, pool, bothIn, scenario) }.forEach { it.get(10, TimeUnit.SECONDS) }

        assertNested(report(scenario), "lamp-01", "desk-02")
    }

    @Test
    fun `work handed to a pool finds its scenario among several running, and the app's own decorator still runs inside`() {
        start("other", bind = false)
        val scenario = start("pooled", bind = false)
        assertNull(SpringScenarios.resolve(), "two scenarios and neither on this thread")
        val tenant = ThreadLocal<String>()
        val seen = mutableListOf<String?>()
        val own =
            TaskDecorator { task ->
                val captured = "acme"
                Runnable {
                    tenant.set(captured)
                    try {
                        task.run()
                    } finally {
                        tenant.remove()
                    }
                }
            }
        val pool = pool(own)
        val bothIn = CyclicBarrier(1)

        order("lamp-01", pool, bothIn, scenario) { seen += tenant.get() }.get(10, TimeUnit.SECONDS)

        assertEquals(listOf<String?>("acme"), seen, "the app's decorator ran")
        val drawn = report(scenario, "pooled")
        assertEquals(listOf("POST /orders/lamp-01", "save(\"lamp-01\")", "\"LAMP-01\"", "201 Created"), drawn.labels, drawn.json)
        assertNested(drawn, "lamp-01")
    }

    @Test
    fun `work the test itself hands to a pool is the test's, and outside a scenario a task is left as it is`() {
        val task = Runnable {}
        assertSame(task, LsdTaskDecorator.decorate(task), "no scenario, nothing to carry")

        val scenario = start("direct", bind = true)
        val pool = pool()
        pool.submit { orders.save("lamp-01") }.get(5, TimeUnit.SECONDS)

        val drawn = report(scenario, "direct")
        assertEquals("client", drawn.message("save(\"lamp-01\")")["from"], drawn.json)
    }

    @Test
    fun `every kind of Spring executor gets the decorator once, after the app's own`() {
        val processor = LsdExecutorPostProcessor()
        val simple = SimpleAsyncTaskExecutor()
        val scheduler = ThreadPoolTaskScheduler()
        for (executor in listOf(simple, scheduler)) {
            processor.postProcessBeforeInitialization(executor, "executor")
            processor.postProcessBeforeInitialization(executor, "executor")
            assertSame(
                LsdTaskDecorator,
                org.springframework.beans
                    .DirectFieldAccessor(executor)
                    .getPropertyValue("taskDecorator"),
            )
        }
        val own = TaskDecorator { it }
        val pool = ThreadPoolTaskExecutor().apply { setTaskDecorator(own) }
        processor.postProcessBeforeInitialization(pool, "pool")
        assertTrue(
            org.springframework.beans
                .DirectFieldAccessor(pool)
                .getPropertyValue("taskDecorator") is
                org.springframework.core.task.support.CompositeTaskDecorator,
        )
        assertSame("left alone", processor.postProcessBeforeInitialization("left alone", "string"))
    }

    @Test
    fun `the listener waits for a request still being answered, and no longer than its limit`() {
        val scenario = start()
        SpringScenarios.enter(scenario, "late")
        val left = AtomicBoolean()
        val answered = Thread {
            Thread.sleep(50)
            left.set(true)
            SpringScenarios.leave(scenario, "late")
        }.apply { start() }
        SpringScenarios.settle(scenario, timeoutMs = 10_000)
        assertTrue(left.get(), "settled before the request was left")
        answered.join()

        SpringScenarios.enter(scenario, "never")
        val t0 = System.nanoTime()
        SpringScenarios.settle(scenario, timeoutMs = 20)
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 1_000, "gave up at its limit")
        SpringScenarios.leave(scenario, "never")
    }
}
