plugins {
    // Root is a thin aggregator; convention plugins live in build-logic.
    base
}

group = "io.lsdconsulting"
version = "0.0.1-SNAPSHOT"

// Picks up every subproject that registers readmeSamples, including ones added later.
tasks.register("readmeSamples") {
    group = "documentation"
    description =
        "Regenerate README sample images for every module that defines a readmeSamples task."
}

gradle.projectsEvaluated {
    val moduleSamples = subprojects.mapNotNull { it.tasks.findByName("readmeSamples") }
    tasks.named("readmeSamples").configure {
        dependsOn(moduleSamples)
    }
}
