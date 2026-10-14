plugins {
    base
}

group = "io.lsdconsulting"
// Every module is on the train: the version set once on the root project (docs/versioning-notes.md).
version = rootProject.version

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
