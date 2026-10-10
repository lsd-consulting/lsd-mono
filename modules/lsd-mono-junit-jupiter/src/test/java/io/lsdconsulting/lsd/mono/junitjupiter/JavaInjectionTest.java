package io.lsdconsulting.lsd.mono.junitjupiter;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.lsdconsulting.lsd.mono.core.LsdContext;
import io.lsdconsulting.lsd.mono.core.LsdScenario;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/** The extension's LsdScenario parameter, from Java. */
@ExtendWith(LsdExtension.class)
class JavaInjectionTest {
    @Test
    void scenarioIsInjected(LsdScenario scenario) {
        assertSame(LsdContext.getInstance().currentScenario(), scenario);
        assertTrue(scenario.isActive());
        scenario.capture(c -> c.calls("Java", "LsdMono").label("injected"));
    }
}
