package io.github.lsdconsulting.lsd.mono.junitjupiter;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.github.lsdconsulting.lsd.mono.jvm.LsdContext;
import io.github.lsdconsulting.lsd.mono.jvm.LsdScenario;
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
