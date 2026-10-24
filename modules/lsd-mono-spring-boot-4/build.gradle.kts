import io.lsdconsulting.lsd.mono.gradle.writesSampleReport

plugins {
    id("lsd.kotlin-jvm")
    `java-library`
}

// A little under the measured 91.7% line coverage; lsd.coverage fails below it and more than 3 points above it.
lsdCoverage {
    lineFloor.set(89)
}

description =
    "LSD Mono Spring Boot 4 integration — add it to the tests and every @SpringBootTest writes a living sequence diagram"

// The test lifecycle reaches core's integration-only API (as lsd-mono-cucumber-8 does).
kotlin {
    compilerOptions {
        optIn.add("io.lsdconsulting.lsd.mono.core.InternalLsdApi")
    }
}

// Built against Spring Boot 4 (Spring Framework 7, Jackson 3). The exact version is the catalog's
// `spring-boot`; this only stops a resolve from landing on another major. Spring Boot 5 would be a
// new module (lsd-mono-spring-boot-5), not a move of this pin. Spring Framework's version is never
// declared here: it is whatever the Boot BOM manages.
majorLines {
    pin("Spring Boot 4", 4, listOf("org.springframework.boot"))
    pin("Spring Framework 7", 7, listOf("org.springframework"))
    pin("Spring Data 4", 4, listOf("org.springframework.data"))
    pin("Spring for Apache Kafka 4", 4, listOf("org.springframework.kafka"))
    pin("Apache Kafka 4", 4, listOf("org.apache.kafka"))
}

// The JUnit the Spring Boot BOM manages (6.0.x for Boot 4.1), which the starter's tests run on
// rather than the repo's JUnit (`junit` in the catalog). Resolved here only to check, in
// BootJunitVersionTest, that `spring-boot-junit` in the catalog still matches the BOM.
val bootManagedJunit: Configuration by configurations.creating {
    isCanBeConsumed = false
    isCanBeResolved = true
}

dependencies {
    api(project(":modules:lsd-mono-core"))

    // Spring is the application's, not ours: compile against it and ship none of it, so the app's
    // own Boot 4.x wins. Each part of the auto-configuration switches on only when its classes are
    // on the test classpath.
    compileOnly(platform(libs.spring.boot.bom))
    compileOnly("org.springframework.boot:spring-boot-autoconfigure")
    compileOnly("org.springframework.boot:spring-boot-restclient")
    compileOnly("org.springframework:spring-web")
    compileOnly("org.springframework:spring-test")
    compileOnly("org.springframework:spring-aop")
    compileOnly("org.springframework.data:spring-data-commons")
    compileOnly("org.springframework.kafka:spring-kafka")
    compileOnly("org.apache.kafka:kafka-clients")
    compileOnly("jakarta.servlet:jakarta.servlet-api")
    compileOnly("tools.jackson.core:jackson-databind")

    // Tests run a real @SpringBootTest app (Tomcat, RestClient, RestTemplate, an in-memory Spring
    // Data repository, an embedded Kafka broker) on Boot's own managed versions, JUnit included.
    testImplementation(platform(libs.spring.boot.bom))
    testImplementation("org.springframework.boot:spring-boot-starter-webmvc")
    testImplementation("org.springframework.boot:spring-boot-restclient")
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.data:spring-data-keyvalue")
    testImplementation("org.springframework.boot:spring-boot-starter-kafka")
    testImplementation("org.springframework.boot:spring-boot-starter-kafka-test")
    // LsdTestConfig, ReportJson and ReportSchemas (#74).
    testImplementation(testFixtures(project(":modules:lsd-mono-core")))
    // A class that already uses LsdExtension is left to it; the tests check both on Boot's JUnit.
    testImplementation(project(":modules:lsd-mono-junit-jupiter"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")

    bootManagedJunit(platform(libs.spring.boot.bom))
    bootManagedJunit("org.junit.jupiter:junit-jupiter-api")
}

// Every org.junit artifact on the test classpaths at Boot's JUnit, though core's test fixtures and
// lsd-mono-junit-jupiter bring the repo's newer one.
val bootJunit = libs.versions.spring.boot.junit
    .get()
configurations.matching { it.name.startsWith("test") }.configureEach {
    resolutionStrategy.eachDependency {
        if (requested.group == "org.junit" || requested.group.startsWith("org.junit.")) {
            useVersion(bootJunit)
            because("lsd-mono-spring-boot-4's tests run on the JUnit the Spring Boot BOM manages")
        }
    }
}

val managedJunitJars = bootManagedJunit.incoming.artifacts.resolvedArtifacts
val moduleBuildFiles =
    rootProject.layout.projectDirectory
        .dir("modules")
        .asFileTree
        .matching { include("*/build.gradle.kts") }

tasks.test {
    useJUnitPlatform {
        // @SpringBootTest fixtures, launched explicitly from StarterEndToEndTest.
        excludeTags("lsd-fixture")
    }
    systemProperty("lsd.mono.report.outputDir", "build/reports/lsd-test")
    systemProperty("lsd.mono.report.usagePing", "false")
    // BootJunitVersionTest: the version of junit-jupiter-api the Boot BOM picks.
    val managed =
        managedJunitJars.map { artifacts ->
            artifacts
                .map { it.id.componentIdentifier }
                .filterIsInstance<ModuleComponentIdentifier>()
                .single { it.group == "org.junit.jupiter" && it.module == "junit-jupiter-api" }
                .version
        }
    inputs.property("bootManagedJunit", managed)
    jvmArgumentProviders.add(CommandLineArgumentProvider { listOf("-Dlsd.test.bootManagedJunit=${managed.get()}") })
    // DependencyDirectionTest reads every module's build file.
    inputs.files(moduleBuildFiles).withPathSensitivity(PathSensitivity.RELATIVE).withPropertyName("moduleBuildFiles")
    systemProperty(
        "lsd.test.modulesDir",
        rootProject.layout.projectDirectory
            .dir("modules")
            .asFile.path,
    )
}

// The sample report the module README links to: the shop fixtures, plain @SpringBootTest classes,
// run with the starter and nothing else, writing a deterministic report into build/sample-report.
// Not part of build or check: Kover leaves this test task out, so koverVerify never runs it.
// ShopFixture's failsAfterPlacingAnOrder is meant to fail, to show an error scenario with its
// reason, so this task ignores test failures and checks instead that every report was written.
val sampleReportDir = layout.buildDirectory.dir("sample-report")
val sampleReportTests =
    tasks.register<Test>("sampleReportTests") {
        description = "Run the shop fixtures and write the sample report into build/sample-report."
        testClassesDirs = sourceSets.test
            .get()
            .output.classesDirs
        classpath = sourceSets.test.get().runtimeClasspath
        useJUnitPlatform { includeTags("lsd-fixture") }
        filter {
            includeTestsMatching("io.lsdconsulting.lsd.mono.springboot.fixture.ShopFixture")
            includeTestsMatching("io.lsdconsulting.lsd.mono.springboot.fixture.KafkaShopFixture")
            includeTestsMatching("io.lsdconsulting.lsd.mono.springboot.fixture.KafkaBatchListenerFixture")
        }
        writesSampleReport(sampleReportDir)
        ignoreFailures = true
        val dir = sampleReportDir.get().asFile
        doLast {
            val diagrams = dir.listFiles { f -> f.name.endsWith("-diagram.html") }.orEmpty().map { it.name }
            val expected = listOf("shop-fixture-", "kafka-shop-fixture-", "kafka-batch-listener-fixture-")
            check(expected.all { prefix -> diagrams.any { it.startsWith(prefix) } }) {
                "sampleReportTests wrote $diagrams, not the shop, Kafka shop and Kafka batch listener reports"
            }
        }
    }
kover {
    currentProject {
        instrumentation { disabledForTestTasks.add(sampleReportTests.name) }
    }
}

// The sample as published on Pages under spring-boot-4/: the report index plus each report, with
// stable addresses for the three diagrams (files carry a short hash). The Pages workflow copies
// build/pages into the site next to lsd-mono-core's example report.
tasks.register<Sync>("sampleReport") {
    group = "documentation"
    description = "Build the Spring Boot starter's sample report site into build/pages. Not part of build or check."
    dependsOn(sampleReportTests)
    from(sampleReportDir) { exclude(".lsd-index/**") }
    from(sampleReportDir) {
        include("shop-fixture-*-diagram.html")
        rename("""shop-fixture-[0-9a-f]{8}-diagram\.html""", "shop-report.html")
    }
    from(sampleReportDir) {
        include("kafka-shop-fixture-*-diagram.html")
        rename("""kafka-shop-fixture-[0-9a-f]{8}-diagram\.html""", "kafka-shop-report.html")
    }
    from(sampleReportDir) {
        include("kafka-batch-listener-fixture-*-diagram.html")
        rename("""kafka-batch-listener-fixture-[0-9a-f]{8}-diagram\.html""", "kafka-batch-listener-report.html")
    }
    into(layout.buildDirectory.dir("pages"))
}
