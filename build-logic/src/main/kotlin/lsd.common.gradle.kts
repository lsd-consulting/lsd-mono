import io.lsdconsulting.lsd.mono.gradle.VersionAlignment

plugins {
    base
}

group = "io.lsdconsulting"

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}

val overridesFile = rootProject.layout.projectDirectory.file(VersionAlignment.OVERRIDES_PATH).asFile
if (!overridesFile.isFile) {
    throw GradleException("Missing ${overridesFile.path}. Record a patch or solo major there, or leave the file empty.")
}
val recorded = try {
    VersionAlignment.parse(overridesFile.readText())
} catch (ex: IllegalArgumentException) {
    throw GradleException(ex.message ?: "Could not read version overrides")
}
val unknown = recorded.keys.filter { rootProject.findProject(it) == null }
if (unknown.isNotEmpty()) {
    throw GradleException(
        "${VersionAlignment.OVERRIDES_PATH} names ${unknown.joinToString()} which is not a project."
    )
}
val train = rootProject.version.toString()
if (train == "unspecified") {
    throw GradleException("Set the train version on the root project. Modules inherit it.")
}
val mine = recorded[project.path]
VersionAlignment.recordedProblem(project.path, train, mine)?.let { throw GradleException(it) }
version = mine?.version ?: train

val projectPath = path
var alignedVersion = version.toString()
afterEvaluate {
    alignedVersion = version.toString()
    val failure = VersionAlignment.alignmentFailure(
        projectPath,
        alignedVersion,
        rootProject.version.toString(),
        mine,
    )
    if (failure != null) {
        throw GradleException(failure)
    }
}
val checkVersionAlignment = tasks.register("checkVersionAlignment") {
    group = "verification"
    description =
        "Fail unless this module matches the root train version, or a recorded patch or solo-major override."
    inputs.file(overridesFile)
    doLast {
        logger.lifecycle("$projectPath $alignedVersion (train $train)")
    }
}
tasks.named("check").configure {
    dependsOn(checkVersionAlignment)
}
tasks.withType<Jar>().configureEach {
    dependsOn(checkVersionAlignment)
}
