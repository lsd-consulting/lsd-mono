package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.springframework.beans.DirectFieldAccessor
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.core.task.SimpleAsyncTaskExecutor
import org.springframework.core.task.TaskDecorator
import org.springframework.core.task.support.CompositeTaskDecorator
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler

/**
 * Work handed to a pool keeps the scenario and the call that handed it over: a task submitted
 * while the app serves a request (or handles a Kafka message) runs with that request as the parent
 * of its own calls, on whichever thread the pool picks. Outside a scenario it returns the task as is.
 */
internal object LsdTaskDecorator : TaskDecorator {
    override fun decorate(runnable: Runnable): Runnable {
        if (runnable is Carried) return runnable
        val work = guarded(null) { SpringScenarios.capture() } ?: return runnable
        return Carried(runnable, work)
    }

    private class Carried(
        private val task: Runnable,
        private val work: SpringScenarios.Current,
    ) : Runnable {
        override fun run() = SpringScenarios.within(work) { task.run() }
    }
}

/**
 * Adds [LsdTaskDecorator] to every Spring-managed `ThreadPoolTaskExecutor`, `SimpleAsyncTaskExecutor`
 * (and so `SimpleAsyncTaskScheduler`) and `ThreadPoolTaskScheduler` bean, before it initialises:
 * Spring Boot's `applicationTaskExecutor` (so `@Async`), its task scheduler, and executors the app
 * declares itself. The app's own decorator is kept and runs inside ours ([CompositeTaskDecorator]).
 *
 * Spring offers no getter for an executor's decorator, so it is read from the executor's
 * `taskDecorator` field; if that ever fails the executor is left exactly as it was.
 */
internal class LsdExecutorPostProcessor : BeanPostProcessor {
    override fun postProcessBeforeInitialization(
        bean: Any,
        beanName: String,
    ): Any {
        when (bean) {
            is ThreadPoolTaskExecutor -> decorate(bean, bean::setTaskDecorator)
            is SimpleAsyncTaskExecutor -> decorate(bean, bean::setTaskDecorator)
            is ThreadPoolTaskScheduler -> decorate(bean, bean::setTaskDecorator)
        }
        return bean
    }

    private fun decorate(
        executor: Any,
        set: (TaskDecorator) -> Unit,
    ) = guarded(Unit) {
        val own = DirectFieldAccessor(executor).getPropertyValue("taskDecorator") as TaskDecorator?
        if (own === LsdTaskDecorator) return@guarded
        set(if (own == null) LsdTaskDecorator else CompositeTaskDecorator(listOf(own, LsdTaskDecorator)))
    }
}
