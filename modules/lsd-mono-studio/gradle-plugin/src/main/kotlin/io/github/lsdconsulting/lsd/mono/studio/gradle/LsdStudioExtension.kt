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
}
