# modules/

Git submodules live here. Each submodule typically keeps its own independent
Gradle (or other) build; the monorepo root does not include them as Gradle
projects by default.

## Role vs mono core

Submodules here are for **source ownership and API/inspiration reference**.
They are **not** the first-party mono product:

- **Mono core artifact:** `integrations/lsd-mono-core` (greenfield report-next + façade)
- **Legacy `lsd-core` submodule:** useful when migrating APIs or comparing behaviour;
  do not vendor its sources into `lsd-mono-core` as the product

## Current

| Path | Remotes | Role |
|------|---------|------|
| `lsd-core/` | https://github.com/lsd-consulting/lsd-core.git | Inspiration / API reference only |

## Adding another submodule

```bash
git submodule add https://github.com/lsd-consulting/<repo>.git modules/<repo>
git commit -m "Add modules/<repo> submodule"
```

Optional later: wire a submodule into the root via `includeBuild("modules/<repo>")`
in `settings.gradle.kts` if you want a Gradle composite build for experiments.
