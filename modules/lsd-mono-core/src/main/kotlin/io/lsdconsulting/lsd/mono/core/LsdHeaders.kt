package io.lsdconsulting.lsd.mono.core

/**
 * Header names for carrying a scenario across a process boundary. A producer or HTTP client
 * interceptor writes [LsdScenario.key] under [SCENARIO]; the receiving side looks the
 * scenario up with [LsdContext.findScenario] and captures into it.
 */
public object LsdHeaders {
    /** The key of the scenario that sent the message or request. */
    public const val SCENARIO: String = "lsd-scenario"
}
