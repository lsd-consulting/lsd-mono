package io.github.lsdconsulting.lsd.mono.springboot

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario
import io.github.lsdconsulting.lsd.mono.jvm.testing.LsdTestConfig
import io.github.lsdconsulting.lsd.mono.jvm.testing.ReportJson
import io.github.lsdconsulting.lsd.mono.jvm.testing.ScenarioJson
import jakarta.servlet.FilterChain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertInstanceOf
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertSame
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.springframework.aop.framework.ProxyFactory
import org.springframework.boot.autoconfigure.AutoConfigurations
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.task.SimpleAsyncTaskExecutor
import org.springframework.core.task.TaskDecorator
import org.springframework.core.task.support.ExecutorServiceAdapter
import org.springframework.mock.env.MockEnvironment
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler
import java.util.concurrent.Callable
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ThreadPoolExecutor
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
    ): CompletableFuture<Unit> = order(sku, { pool.submit(it).get(5, TimeUnit.SECONDS) }, bothIn, scenario, onPool)

    /** POST /orders/[sku] through the servlet filter, on its own thread, saving the order through [hand]. */
    private fun order(
        sku: String,
        hand: (Callable<Unit>) -> Unit,
        bothIn: CyclicBarrier,
        scenario: LsdScenario,
        onPool: () -> Unit = {},
    ): CompletableFuture<Unit> =
        CompletableFuture.supplyAsync({
            val request = MockHttpServletRequest("POST", "/orders/$sku")
            request.addHeader(io.github.lsdconsulting.lsd.mono.jvm.LsdHeaders.SCENARIO, scenario.correlationId)
            inbound.doFilter(
                request,
                MockHttpServletResponse(),
                FilterChain { _, response ->
                    // Both requests are being served before either hands its work over.
                    bothIn.await(5, TimeUnit.SECONDS)
                    hand(Callable { onPool().also { orders.save(sku) } })
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

    /** Plain pools as the app declares them, one way of handing work over each. */
    private fun plainHands(): List<Pair<String, (Callable<Unit>) -> Unit>> {
        val plain = LsdExecutorService(Executors.newFixedThreadPool(2)).also { pools += AutoCloseable { it.shutdownNow() } }
        val timer = LsdScheduledExecutorService(Executors.newScheduledThreadPool(2)).also { pools += AutoCloseable { it.shutdownNow() } }
        val wait = 5L to TimeUnit.SECONDS
        return listOf(
            "submit" to { task -> plain.submit(task).get(wait.first, wait.second) },
            "runnable" to { task -> plain.submit(Runnable { task.call() }).get(wait.first, wait.second) },
            "result" to { task -> plain.submit(Runnable { task.call() }, Unit).get(wait.first, wait.second) },
            "execute" to { task ->
                val done = CountDownLatch(1)
                plain.execute {
                    task.call()
                    done.countDown()
                }
                assertTrue(done.await(wait.first, wait.second))
            },
            "all" to { task -> plain.invokeAll(listOf(task)).single().get() },
            "alltimed" to { task -> plain.invokeAll(listOf(task), wait.first, wait.second).single().get() },
            "any" to { task -> plain.invokeAny(listOf(task)) },
            "anytimed" to { task -> plain.invokeAny(listOf(task), wait.first, wait.second) },
            "schedule" to { task -> timer.schedule(task, 1, TimeUnit.MILLISECONDS).get(wait.first, wait.second) },
            "delayed" to { task -> timer.schedule(Runnable { task.call() }, 1, TimeUnit.MILLISECONDS).get(wait.first, wait.second) },
            "rate" to { task -> periodic(task) { run -> timer.scheduleAtFixedRate(run, 0, 10, TimeUnit.MILLISECONDS) } },
            "delay" to { task -> periodic(task) { run -> timer.scheduleWithFixedDelay(run, 0, 10, TimeUnit.MILLISECONDS) } },
        )
    }

    /** Runs [task] on the first tick of a periodic schedule, then cancels it. */
    private fun periodic(
        task: Callable<Unit>,
        schedule: (Runnable) -> java.util.concurrent.Future<*>,
    ) {
        val done = CountDownLatch(1)
        val ticks =
            schedule {
                if (done.count > 0) {
                    task.call()
                    done.countDown()
                }
            }
        assertTrue(done.await(5, TimeUnit.SECONDS))
        ticks.cancel(false)
    }

    @Test
    fun `two requests served at once each keep the work they hand to a plain ExecutorService, however it is handed over`() {
        val scenario = start()
        val hands = plainHands()
        for ((how, hand) in hands) {
            val bothIn = CyclicBarrier(2)
            listOf("$how-1", "$how-2").map { order(it, hand, bothIn, scenario) }.forEach { it.get(10, TimeUnit.SECONDS) }
        }

        assertNested(report(scenario), *hands.flatMap { (how, _) -> listOf("$how-1", "$how-2") }.toTypedArray())
    }

    @Test
    fun `outside a scenario a plain pool gets the task exactly as it was handed over`() {
        val seen = mutableListOf<Any>()
        val recording =
            object : java.util.concurrent.AbstractExecutorService() {
                override fun execute(command: Runnable) {
                    seen += command
                    command.run()
                }

                override fun <T> submit(task: Callable<T>): java.util.concurrent.Future<T> {
                    seen += task
                    return CompletableFuture.completedFuture(task.call())
                }

                override fun shutdown() = Unit

                override fun shutdownNow(): MutableList<Runnable> = mutableListOf()

                override fun isShutdown() = false

                override fun isTerminated() = false

                override fun awaitTermination(
                    timeout: Long,
                    unit: TimeUnit,
                ) = true
            }
        val wrapped = LsdExecutorService(recording)
        val task = Callable { "done" }
        val command = Runnable {}
        assertEquals("done", wrapped.submit(task).get())
        wrapped.execute(command)
        assertEquals(listOf<Any>(task, command), seen)
        assertTrue(wrapped.toString().startsWith("LsdExecutorService("))
    }

    @Configuration(proxyBeanMethods = false)
    class Pools {
        @Bean
        fun plainPool(): ExecutorService = Executors.newFixedThreadPool(1).also { raw = it }

        @Bean
        fun timerPool(): ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor()

        @Bean
        fun classPool(): ThreadPoolExecutor = Executors.newFixedThreadPool(1) as ThreadPoolExecutor

        @Bean
        fun adapted(): ExecutorService = ExecutorServiceAdapter(ThreadPoolTaskExecutor().apply { initialize() })

        companion object {
            @Volatile var raw: ExecutorService? = null
        }
    }

    private val contexts =
        ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(LsdAutoConfiguration::class.java))
            .withUserConfiguration(Pools::class.java)

    @Test
    fun `plain ExecutorService beans are wrapped when declared as an interface, and still shut down with the context`() {
        contexts.run { context ->
            assertInstanceOf(LsdExecutorService::class.java, context.getBean("plainPool"))
            assertInstanceOf(LsdScheduledExecutorService::class.java, context.getBean("timerPool"))
            assertInstanceOf(LsdExecutorService::class.java, context.getBean("plainPool", ExecutorService::class.java))
            // Declared as a class, so whatever injects it still gets a ThreadPoolExecutor.
            assertFalse(context.getBean("classPool") is LsdExecutorService)
            assertInstanceOf(ThreadPoolExecutor::class.java, context.getBean(ThreadPoolExecutor::class.java))
            // Spring's adapter runs on its TaskExecutor, which carries the scenario already.
            assertInstanceOf(ExecutorServiceAdapter::class.java, context.getBean("adapted"))
        }
        assertTrue(Pools.raw!!.isShutdown, "Spring shut the pool itself down")
    }

    @Test
    fun `lsd mono spring executors enabled false leaves plain ExecutorService beans alone`() {
        contexts.withPropertyValues("lsd.mono.spring.executors.enabled=false").run { context ->
            assertFalse(context.getBean("plainPool") is LsdExecutorService)
            assertFalse(context.getBean("timerPool") is LsdExecutorService)
        }
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
