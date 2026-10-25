package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.beans.factory.BeanFactory
import org.springframework.beans.factory.BeanFactoryAware
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory
import org.springframework.beans.factory.support.RootBeanDefinition
import org.springframework.core.task.TaskExecutor
import org.springframework.core.task.support.ExecutorServiceAdapter
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Future
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * A plain `ExecutorService` bean whose tasks keep the scenario and the call that handed them over,
 * as [LsdTaskDecorator] does for Spring's executors: each task is captured when it is submitted
 * and run within it, on whichever thread the pool picks. Everything else goes straight through.
 */
internal open class LsdExecutorService(
    private val delegate: ExecutorService,
) : ExecutorService by delegate {
    override fun execute(command: Runnable) = delegate.execute(carry(command))

    override fun submit(task: Runnable): Future<*> = delegate.submit(carry(task))

    override fun <T> submit(
        task: Runnable,
        result: T,
    ): Future<T> = delegate.submit(carry(task), result)

    override fun <T> submit(task: Callable<T>): Future<T> = delegate.submit(carry(task))

    override fun <T> invokeAll(tasks: Collection<Callable<T>>): List<Future<T>> = delegate.invokeAll(tasks.map { carry(it) })

    override fun <T> invokeAll(
        tasks: Collection<Callable<T>>,
        timeout: Long,
        unit: TimeUnit,
    ): List<Future<T>> = delegate.invokeAll(tasks.map { carry(it) }, timeout, unit)

    override fun <T> invokeAny(tasks: Collection<Callable<T>>): T = delegate.invokeAny(tasks.map { carry(it) })

    override fun <T> invokeAny(
        tasks: Collection<Callable<T>>,
        timeout: Long,
        unit: TimeUnit,
    ): T = delegate.invokeAny(tasks.map { carry(it) }, timeout, unit)

    override fun toString(): String = "LsdExecutorService($delegate)"

    protected fun carry(task: Runnable): Runnable = LsdTaskDecorator.decorate(task)

    protected fun <T> carry(task: Callable<T>): Callable<T> {
        val work = guarded(null) { SpringScenarios.capture() } ?: return task
        return Callable { SpringScenarios.within(work) { task.call() } }
    }
}

/** [LsdExecutorService] for a `ScheduledExecutorService`: a periodic task keeps the scenario it was scheduled in. */
internal class LsdScheduledExecutorService(
    private val scheduled: ScheduledExecutorService,
) : LsdExecutorService(scheduled),
    ScheduledExecutorService {
    override fun schedule(
        command: Runnable,
        delay: Long,
        unit: TimeUnit,
    ): ScheduledFuture<*> = scheduled.schedule(carry(command), delay, unit)

    override fun <V> schedule(
        callable: Callable<V>,
        delay: Long,
        unit: TimeUnit,
    ): ScheduledFuture<V> = scheduled.schedule(carry(callable), delay, unit)

    override fun scheduleAtFixedRate(
        command: Runnable,
        initialDelay: Long,
        period: Long,
        unit: TimeUnit,
    ): ScheduledFuture<*> = scheduled.scheduleAtFixedRate(carry(command), initialDelay, period, unit)

    override fun scheduleWithFixedDelay(
        command: Runnable,
        initialDelay: Long,
        delay: Long,
        unit: TimeUnit,
    ): ScheduledFuture<*> = scheduled.scheduleWithFixedDelay(carry(command), initialDelay, delay, unit)

    override fun toString(): String = "LsdScheduledExecutorService($scheduled)"
}

/**
 * Wraps every plain `ExecutorService` and `ScheduledExecutorService` bean in [LsdExecutorService]
 * (or [LsdScheduledExecutorService]), once it is initialised. Spring's own executors are left to
 * [LsdExecutorPostProcessor], and Spring's `ExecutorServiceAdapter` to the executor it adapts.
 *
 * Only a bean declared as an interface the wrapper also implements (`ExecutorService`,
 * `ScheduledExecutorService`, `Executor`) is wrapped, so anything that injects it still gets the
 * type it asked for. One declared as a class (`ThreadPoolExecutor`) is left as it is. Spring
 * shuts the pool down as before: it calls the bean's destroy method on the pool, not the wrapper.
 */
internal class LsdExecutorServicePostProcessor :
    BeanPostProcessor,
    BeanFactoryAware {
    private var beans: ConfigurableListableBeanFactory? = null

    override fun setBeanFactory(beanFactory: BeanFactory) {
        beans = beanFactory as? ConfigurableListableBeanFactory
    }

    override fun postProcessAfterInitialization(
        bean: Any,
        beanName: String,
    ): Any {
        if (bean !is ExecutorService || bean is LsdExecutorService || bean is TaskExecutor || bean is ExecutorServiceAdapter) {
            return bean
        }
        return guarded(bean) {
            val wrapped = if (bean is ScheduledExecutorService) LsdScheduledExecutorService(bean) else LsdExecutorService(bean)
            val declared = declaredType(beanName)
            if (declared != null && declared.isInterface && declared.isInstance(wrapped)) wrapped else bean
        }
    }

    /** What the bean was declared as: its `@Bean` method's return type, else its bean class (not the instance's). */
    private fun declaredType(beanName: String): Class<*>? {
        val factory = beans?.takeIf { it.containsBeanDefinition(beanName) } ?: return null
        val definition = factory.getMergedBeanDefinition(beanName) as? RootBeanDefinition ?: return null
        definition.resolvedFactoryMethod?.let { return it.returnType }
        return if (definition.hasBeanClass()) definition.beanClass else null
    }
}
