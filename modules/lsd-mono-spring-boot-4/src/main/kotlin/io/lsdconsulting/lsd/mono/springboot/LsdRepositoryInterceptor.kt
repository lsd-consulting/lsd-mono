package io.lsdconsulting.lsd.mono.springboot

import io.lsdconsulting.lsd.mono.core.Interaction
import io.lsdconsulting.lsd.mono.core.InteractionKind
import io.lsdconsulting.lsd.mono.core.Trace
import io.lsdconsulting.lsd.mono.core.domain.ParticipantType
import io.lsdconsulting.lsd.mono.springboot.SpringScenarios.guarded
import org.aopalliance.intercept.MethodInterceptor
import org.aopalliance.intercept.MethodInvocation
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.context.EnvironmentAware
import org.springframework.core.env.Environment
import org.springframework.data.repository.core.support.RepositoryFactoryBeanSupport
import java.time.Instant

/**
 * Adds [LsdRepositoryInterceptor] to every Spring Data repository, whatever the store, the way
 * Spring Boot's own repository metrics do: through the repository factory bean, before it builds
 * the proxy. Nothing is instrumented below the repository (no JDBC, no SQL).
 */
internal class LsdRepositoryPostProcessor :
    BeanPostProcessor,
    EnvironmentAware {
    private lateinit var env: Environment
    private val names by lazy { ParticipantNames(env) }

    override fun setEnvironment(environment: Environment) {
        env = environment
    }

    override fun postProcessBeforeInitialization(
        bean: Any,
        beanName: String,
    ): Any {
        if (bean is RepositoryFactoryBeanSupport<*, *, *>) {
            bean.addRepositoryFactoryCustomizer { factory ->
                factory.addRepositoryProxyPostProcessor { proxy, information ->
                    proxy.addAdvice(LsdRepositoryInterceptor(information.repositoryInterface) { names })
                }
            }
        }
        return bean
    }
}

/**
 * Draws each repository call made during a test as a call and its reply:
 * `Shop → OrderRepository: save(PlacedOrder(sku=lamp-01))`, then `PlacedOrder(…)` back. The
 * repository is a database on the diagram, named after its interface.
 */
internal class LsdRepositoryInterceptor(
    repository: Class<*>,
    private val names: () -> ParticipantNames,
) : MethodInterceptor {
    private val target = repository.simpleName.ifEmpty { repository.name }

    override fun invoke(invocation: MethodInvocation): Any? {
        val method = invocation.method
        if (method.declaringClass == Any::class.java) return invocation.proceed()
        val scenario = guarded(null) { SpringScenarios.resolve() } ?: return invocation.proceed()
        val id = SpringScenarios.newId()
        val parent = SpringScenarios.parentOf(scenario)
        val caller = guarded(ParticipantNames.DEFAULT_CLIENT) { if (parent == null) names().client else names().app }
        val t0 = System.nanoTime()
        guarded(Unit) {
            val args = invocation.arguments.map(Summaries::of)
            SpringScenarios.declare(scenario, ParticipantType.DATABASE.called(target))
            scenario.ingest(
                Interaction(
                    kind = InteractionKind.REQUEST,
                    from = caller,
                    to = target,
                    label = Summaries.truncate("${method.name}(${args.joinToString(", ")})"),
                    interactionId = id,
                    trace = Trace(scenario.correlationId, id, parent),
                    source = SpringScenarios.SOURCE,
                    startedAt = Instant.now(),
                    data = mapOf("method" to "${method.declaringClass.simpleName}.${method.name}", "arguments" to args),
                ),
            )
        }
        val result =
            try {
                invocation.proceed()
            } catch (e: Throwable) {
                reply(scenario, id, caller, t0, "error", e.javaClass.simpleName, e.message ?: e.javaClass.name)
                throw e
            }
        guarded(Unit) {
            val returned = if (method.returnType == Void.TYPE) "void" else Summaries.of(result)
            reply(scenario, id, caller, t0, "ok", returned, mapOf("returned" to returned))
        }
        return result
    }

    private fun reply(
        scenario: io.lsdconsulting.lsd.mono.core.LsdScenario,
        id: String,
        caller: String,
        t0: Long,
        status: String,
        label: String,
        data: Any?,
    ) = guarded(Unit) {
        scenario.ingest(
            Interaction(
                kind = InteractionKind.RESPONSE,
                from = target,
                to = caller,
                label = label,
                status = status,
                replyTo = id,
                source = SpringScenarios.SOURCE,
                durationMs = (System.nanoTime() - t0) / 1_000_000.0,
                data = data,
            ),
        )
    }
}
