// Maven Central publishing for every module on lsd.kotlin-jvm: the jar, sources and javadoc
// jars, a full POM, and signatures. The root project's nexusPublishing sends them to Central
// (docs/releasing.md). Nothing here needs a key or a password: publishToMavenLocal works on any
// machine, unsigned, and a release signs with the in-memory key the release workflow provides.
plugins {
    `java-library`
    `maven-publish`
    signing
    id("org.jetbrains.dokka-javadoc")
}

// Central requires a javadoc jar. Dokka's javadoc format documents the Kotlin API. Built only
// when something publishes, so `build` does not run Dokka.
val javadocJar =
    tasks.register<Jar>("javadocJar") {
        group = "documentation"
        description = "Assembles a jar of the Dokka javadoc for publishing."
        archiveClassifier.set("javadoc")
        from(tasks.named("dokkaGeneratePublicationJavadoc"))
    }

publishing {
    // Every publication's POM has what Central requires. Name and description default to the
    // module's.
    publications.withType<MavenPublication>().configureEach {
        val publication = this
        pom {
            name.convention(provider { publication.artifactId })
            description.convention(provider { project.description ?: error("${project.path} needs a description for its POM") })
            url.set("https://github.com/lsd-consulting/lsd-mono")
            inceptionYear.set("2026")
            licenses {
                license {
                    name.set("MIT License")
                    url.set("https://github.com/lsd-consulting/lsd-mono/blob/main/LICENSE")
                    distribution.set("repo")
                }
            }
            developers {
                developer {
                    id.set("nickmcdowall")
                    name.set("Nick McDowall")
                    email.set("nicholas.mcdowall@gmail.com")
                    organization.set("LSD Consulting")
                    organizationUrl.set("https://github.com/lsd-consulting")
                }
            }
            scm {
                url.set("https://github.com/lsd-consulting/lsd-mono")
                connection.set("scm:git:https://github.com/lsd-consulting/lsd-mono.git")
                developerConnection.set("scm:git:ssh://git@github.com/lsd-consulting/lsd-mono.git")
            }
            issueManagement {
                system.set("GitHub")
                url.set("https://github.com/lsd-consulting/lsd-mono/issues")
            }
        }
    }
    publications {
        register<MavenPublication>("maven") {
            // The java component carries the jar and the sources jar (lsd.kotlin-jvm).
            from(components["java"])
            artifact(javadocJar)
            // Publish the dependency versions the build resolved, not only the declared ones.
            versionMapping {
                allVariants { fromResolutionResult() }
            }
        }
    }
}

// Signs only when a key is given: ORG_GRADLE_PROJECT_signingKey (ASCII-armoured) and
// ORG_GRADLE_PROJECT_signingPassword, the organisation secrets lsd-core's release uses too.
// The release runs without the configuration cache, so the key is never stored in it.
val signingKey: Provider<String> = providers.gradleProperty("signingKey")
val signingPassword: Provider<String> = providers.gradleProperty("signingPassword")
signing {
    if (signingKey.isPresent) {
        useInMemoryPgpKeys(signingKey.get(), signingPassword.orNull)
        sign(publishing.publications)
    }
}

// Central rejects unsigned releases, and only after the upload. Fail before it instead.
val signed = signingKey.isPresent
tasks.withType<PublishToMavenRepository>().configureEach {
    if (name.endsWith("ToSonatypeRepository")) {
        doFirst {
            check(signed) { "Publishing to Maven Central needs signingKey and signingPassword (docs/releasing.md)." }
        }
    }
}
