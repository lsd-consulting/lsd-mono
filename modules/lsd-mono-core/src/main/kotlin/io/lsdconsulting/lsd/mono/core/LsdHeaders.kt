package io.lsdconsulting.lsd.mono.core

/**
 * Header names for carrying a scenario across a process boundary. A producer or HTTP client
 * interceptor adds [SCENARIO] with the value of [LsdContext.scenarioHeaderValue] for the
 * target host, and only when that is not null (the host is allowed and a scenario is current).
 * The receiving side looks the scenario up with [LsdContext.findScenarioByHeader] and captures
 * into it. The value is the scenario's random [LsdScenario.correlationId], never its key.
 */
public object LsdHeaders {
    /** The [LsdScenario.correlationId] of the scenario that sent the message or request. */
    public const val SCENARIO: String = "lsd-scenario"
}
