package io.github.lsdconsulting.lsd.mono.studio.gradle

import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property

/** `lsdStudio { … }`: how the `lsdStudio` task runs LSD Studio. */
public abstract class LsdStudioExtension {
    /** The port Studio listens on (default 7357, Studio's own default; 0 picks a free one). */
    public abstract val port: Property<Int>

    /** Listen on every interface rather than localhost only (Studio's `--expose`). Default false. */
    public abstract val expose: Property<Boolean>

    /** Open Studio in the browser once it is up (default true). Never on CI (the `CI` variable is set). */
    public abstract val openBrowser: Property<Boolean>

    /**
     * The Node.js to run, `node` on the `PATH` by default. It must be 22.6 or newer. Studio is
     * started without a shell, so on Windows this must be `node` or a path to `node.exe`, not a
     * .cmd or .bat wrapper.
     */
    public abstract val nodeCommand: Property<String>

    /** The npm that installs lsd-mono-studio, `npm` on the `PATH` by default. */
    public abstract val npmCommand: Property<String>

    /**
     * Which lsd-mono-studio to run instead of the one matching the plugin's version: an exact npm
     * version (`lsd-mono-studio@0.17.0`; a tag or range is refused, as the install is cached), a
     * packed `.tgz`, an https `.tgz` URL, a git URL pinned to a full commit sha
     * (`github:org/repo#<40-hex sha>`), or a directory holding a built lsd-mono-studio
     * (`modules/lsd-mono-studio` in an lsd-mono checkout), which runs in place. Also set by the
     * `lsd.studio.package` Gradle property. Unset, a released plugin runs its own version.
     */
    public abstract val studioPackage: Property<String>

    /**
     * Point the project's `Test` tasks at LSD Studio when it is running on [port] as they start, by
     * passing `-Dlsd.mono.studio.url` (default true). Needs a fixed port; a task that already sets
     * the URL is left alone, and a test task never fails because Studio is not running.
     */
    public abstract val wireTests: Property<Boolean>

    /** Where installed lsd-mono-studio versions are kept (default `<Gradle user home>/caches/lsd-mono-studio`). */
    public abstract val cacheDir: DirectoryProperty

    /**
     * Download Node.js for the `lsdStudio` task instead of using one on the `PATH` (default false),
     * through the node-gradle plugin, which is applied only when this is on. It then also sets
     * [nodeCommand] and [npmCommand] to the downloaded ones. Set it in the build script: it is read once
     * the build script has run, and setting it later fails.
     */
    public abstract val downloadNode: Property<Boolean>

    /** The Node.js version [downloadNode] fetches (default [LsdStudioPlugin.DEFAULT_NODE_VERSION]). */
    public abstract val nodeVersion: Property<String>

    /**
     * Where [downloadNode] fetches Node.js from, for a mirror inside a restricted network (node-gradle's
     * `distBaseUrl`, default https://nodejs.org/dist). A mirror keeps nodejs.org's layout,
     * `v<version>/node-v<version>-<os>-<arch>.tar.gz` (`.zip` on Windows).
     *
     * node-gradle adds this as a project repository, which a build with
     * `RepositoriesMode.FAIL_ON_PROJECT_REPOS` refuses. There, set it to `""` and declare the
     * repository in settings.gradle.kts instead:
     * ```
     * dependencyResolutionManagement {
     *     repositories {
     *         ivy {
     *             name = "Node.js"
     *             setUrl("https://nodejs.org/dist") // or the mirror
     *             patternLayout { artifact("v[revision]/[artifact](-v[revision]-[classifier]).[ext]") }
     *             metadataSources { artifact() }
     *             content { includeModule("org.nodejs", "node") }
     *         }
     *     }
     * }
     * ```
     */
    public abstract val nodeDistUrl: Property<String>

    /**
     * The npm registry that lsd-mono-studio is installed from, passed as `--registry`. Unset, npm's
     * own configuration (.npmrc) applies untouched. Gradle's proxy settings (`systemProp.http.proxyHost`
     * and the rest) are passed to npm either way, unless its proxy variables are already set.
     */
    public abstract val npmRegistry: Property<String>
}
