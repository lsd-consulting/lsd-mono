import io.lsdconsulting.lsd.mono.gradle.MajorLines

// Declares `majorLines { pin(...); ban(...) }`. Every configuration of the project
// rejects a candidate that breaks a declared pin or ban, so a resolve fails loudly
// instead of quietly moving to another major.
val majorLines = extensions.create<MajorLines>("majorLines")

configurations.configureEach {
    resolutionStrategy.componentSelection {
        all {
            majorLines.problem(candidate.group, candidate.module, candidate.version)?.let { reject(it) }
        }
    }
}
