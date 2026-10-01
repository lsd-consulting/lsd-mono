# modules/

Git submodules live here. Each submodule typically keeps its own independent
Gradle (or other) build; the monorepo root does not include them as Gradle
projects by default.

## Current

| Path | Remotes |
|------|---------|
| `lsd-core/` | https://github.com/lsd-consulting/lsd-core.git |

## Adding another submodule

```bash
git submodule add https://github.com/lsd-consulting/<repo>.git modules/<repo>
git commit -m "Add modules/<repo> submodule"
```

Optional later: wire a submodule into the root via `includeBuild("modules/<repo>")`
in `settings.gradle.kts` if you want a Gradle composite build.
