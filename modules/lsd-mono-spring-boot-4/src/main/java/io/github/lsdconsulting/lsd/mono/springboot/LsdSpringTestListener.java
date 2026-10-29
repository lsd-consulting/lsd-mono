package io.github.lsdconsulting.lsd.mono.springboot;

import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;

/**
 * Turns an existing {@code @SpringBootTest} suite into living documentation with no code.
 * Registered through {@code META-INF/spring.factories}, so adding the starter is all it takes:
 * one scenario per test method, one report per test class, and {@code index.html}.
 */
@SuppressWarnings("KotlinInternalInJava")
public final class LsdSpringTestListener extends AbstractTestExecutionListener {
    /** After Spring's own listeners have injected the test, before it runs. */
    private static final int ORDER = 5_000;

    private final LsdSpringTestLifecycle lifecycle = new LsdSpringTestLifecycle();

    /** Made by Spring from {@code META-INF/spring.factories}, which can call a package-private constructor. */
    LsdSpringTestListener() {}

    @Override
    public int getOrder() {
        return ORDER;
    }

    @Override
    public void beforeTestMethod(TestContext testContext) {
        lifecycle.beforeTestMethod(testContext);
    }

    @Override
    public void afterTestMethod(TestContext testContext) {
        lifecycle.afterTestMethod(testContext);
    }

    @Override
    public void afterTestClass(TestContext testContext) {
        lifecycle.afterTestClass(testContext);
    }
}
