# API Freeze

Every public surface DevForgeKit exposes, classified before `v3.0.0-rc1`
is cut. **The rule: anything marked Stable cannot change in a breaking
way before `v4.0.0`.** Experimental and Internal surfaces may change,
be renamed, or be removed in any minor release without notice.

- **Stable** - a documented, user- or plugin-facing contract. Adding is
  fine; renaming, removing, or changing the meaning of an existing field
  is a breaking change and must wait for `v4`.
- **Experimental** - real, shipped, and usable today, but the shape is
  still settling. May change between minor versions; changes should be
  called out in `CHANGELOG.md` but do not require a major version bump.
- **Internal** - an implementation detail. Not part of any contract,
  even if technically reachable (an exported JS function, an
  auto-computed env var). Free to change at any time.

## CLI commands

| Surface | Classification | Notes |
|---|---|---|
| Core command surface (`install`, `doctor`, `check`, `backup`, `restore`, `update`, `config`, `component`, `registry`, `search`, `collection`, `workspace`, `snapshot`, `repair`, `benchmark`, `package`, `graph`, `env`, `compatibility`, `profile`, `recipe`, `plugin`, `theme`, `preferences`, `services`, `uninstall`, `new`, `stats`, `info`, `explain`, `inventory`, `report`, `clean`, `release`, `self-update`, `validate`) | **Stable** | Command names, required positional arguments, and exit-code conventions (`0`=success, non-zero=issues found or failure - see `docs/CompatibilityReport.md`) are frozen. Adding new optional flags is fine; removing or repurposing an existing flag is not. |
| `dashboard` / bare `devforgekit` (TUI entry point) | **Stable** entry point / **Internal** rendering | The launch contract is frozen: no-arg opens the dashboard on a real TTY, any argument takes the classic path, non-TTY/`DEVFORGEKIT_NO_TUI=1` falls back to `--help`. The dashboard's visual layout, page composition, and theme tokens are explicitly *not* frozen - they have already changed twice this project (v1.4.0 theme redesign, v1.4.1 persistent header) without being treated as breaking. |
| `ai chat/doctor/explain/review/generate/analyze/summarize/optimize/repair/planner/models/providers/history/...` | **Experimental** | Real and shipped, but provider wire formats, prompt shapes, and the whole `core/ai/` subsystem are still actively evolving. No breaking-change freeze applies here yet - documented explicitly so a provider/prompt refactor isn't blocked waiting for `v4`. |
| Global flags (`--json`, `--help`, `-h`, `--version`) | **Stable** | |

## `--json` output

Split deliberately rather than rubber-stamped, because this exact sweep
found and fixed 3 real bugs in it hours before this document was
written (see `docs/CompatibilityReport.md`):

| Surface | Classification | Notes |
|---|---|---|
| The **contract**: `--json` produces valid, parseable JSON on stdout and nothing else, on both success and empty-result paths, for every command that advertises the flag | **Stable** | Directly verified this session across 48 commands; the 2 commands that violated it (`repair history`, `benchmark history`) are fixed with regression tests. |
| The **shape** of each command's JSON payload (exact field names/nesting per command) | **Experimental** | No command has a published, versioned output schema (no `--json` equivalent of `registry/schema/*.json`). Field names are stable in practice but not contractually frozen. **Recommendation before `v4`, not before RC1:** publish an explicit JSON schema per `--json`-capable command so this can graduate to Stable with confidence instead of by inertia. |

## Configuration file (`~/.config/devforgekit/config.yaml`)

| Field | Classification | Notes |
|---|---|---|
| `editor`, `shell`, `packageManager`, `fonts`, `browser`, `aiProvider`, `defaultProfile`, `colorOutput`, `tuiTheme` | **Stable** | Read and acted on today; documented. |
| `mirrors`, `registryUrl`, `updateSchedule`, `telemetry` | **Experimental** | Settable today but **not yet consumed by anything** (`CLAUDE.md`'s own words) - no remote fetch or scheduler exists yet. Freezing the meaning of a field before it does anything would lock in a guess. Left Experimental on purpose so the eventual implementation isn't constrained by a premature contract. |

## Registry schemas (`registry/schema/*.json`)

| Surface | Classification | Notes |
|---|---|---|
| `package.schema.json`, `category.schema.json`, `collection.schema.json`, `profile.schema.json`, `recipe.schema.json`, `compatibility.schema.json` | **Stable** | ajv-validated, referential-integrity-checked (`checkIntegrity()`), 261 real packages depend on this shape today. Adding an optional field is fine (this schema has grown several times already - `architectures`, `versionCommand`, `recommendedAlternatives` - without a breaking change); removing or repurposing a required field is not. |
| Generated artifacts (`registry/registry.json`, `docs/Registry.md`, `profiles/generated/brewfile-categories.txt`) | **Internal** | Machine-generated, CI-gated against drift, never hand-edited. Their exact shape can change whenever the generator changes; nothing external should depend on their internals directly - only the source schemas above are the contract. |

## Environment variables

| Variable | Classification | Notes |
|---|---|---|
| `DEVFORGEKIT_NO_TUI`, `DEVFORGEKIT_NO_ANIMATION`, `DEV_SETUP_ASSUME_YES` | **Stable** | Documented, user-facing, load-bearing in CI (every non-interactive invocation across this whole compatibility sweep relied on `DEVFORGEKIT_NO_TUI=1`). |
| `DEVFORGEKIT_EVENT_PAYLOAD` | **Stable** (as part of the Plugin API) | A real plugin-hook script reads this to receive its event payload (`install.afterInstall` etc.) - changing its shape breaks every installed plugin's hooks, so it's frozen alongside the Plugin API below, not treated as a loose internal. |
| `DEV_SETUP_ROOT` | **Internal** | Auto-computed by `common.sh` from the script's own location, not meant to be set by a user. |
| `DEVFORGEKIT_CRED_BACKEND`, `DEVFORGEKIT_CRED_LOG` | **Internal** | Explicitly "for testing" per the source comment (credential backend override/mock logging). |
| `DEVFORGEKIT_DEBUG`, `DEVFORGEKIT_TUI_DEBUG`, `DEVFORGEKIT_THEME_GALLERY` | **Internal** | Debug/dev-mode toggles, not part of any documented user contract. |
| `DEVFORGEKIT_TEST_MODE`, `DEVFORGEKIT_TEST_LOG` | **Internal** | Test-harness-only (routes `uninstall`'s destructive commands through a logged no-op for `cli/test/uninstall.test.js`). |

## Plugin API

| Surface | Classification | Notes |
|---|---|---|
| `plugin.yml` manifest shape (`schemaVersion`, `name`, `version`, `description`, `engine`, `commands`, `events`, `dependencies`, `rules`) | **Stable** | Already versioned internally (`schemaVersion`, currently 2) and semver-checked against the CLI's own `VERSION` via `engine` - the schema was designed with forward evolution in mind, a good sign this can hold a real freeze. |
| Event names (`install.beforeInstall`, `install.afterInstall`, ...) and the `DEVFORGEKIT_EVENT_PAYLOAD` hook contract | **Stable** | Third-party plugin hook scripts depend on this directly. |
| Plugin trust ledger format (`~/.config/devforgekit/plugin-trust.json`), Ed25519 signing (`core/signing.js`) | **Stable** | Security-relevant; changing this format silently would be a real trust regression, not just an API break. |
| `core/pluginSdk.js` internal function signatures (`devforgekit plugin create/test/build/package`'s own JS implementation) | **Internal** | Not imported by third-party plugins - they interact only through the manifest and hook scripts above. |

## Workspace format

| Surface | Classification | Notes |
|---|---|---|
| `workspace.schema.json` (`schemaVersion: 3`, ajv-validated) | **Stable** | Already has a real, tested migration chain (`migrateWorkspace`, v1→v2→v3) and explicitly refuses to guess on a newer-than-supported document rather than silently corrupting it - exactly the forward-compatible design an API freeze should reward, not restrict. Future schema bumps go through the same migration-table pattern, not a breaking rewrite. |
| Bundle export/import format (`.tar.gz`, secrets and snapshot history deliberately excluded) | **Stable** | |

## Snapshot format

| Surface | Classification | Notes |
|---|---|---|
| Point-in-time JSON snapshot shape (`core/workspace/snapshot.js`) | **Stable** | |
| Snapshot ID scheme (collision-proof, same-millisecond-safe - a real bug this caught before shipping) | **Stable** | |

## Component schema

Covered under **Registry schemas** above (`package.schema.json` *is* the
component schema - not a separate surface).

## Internal helper APIs

Every exported function under `cli/src/core/*.js` and `cli/src/lib/*.js`
that is not one of the documented surfaces above (schemas, event names,
env vars) is **Internal** by default, even where it's technically
`export`ed and reachable from a test file. `mapWithConcurrency`,
`captureShellCommandWithDetails`, `assertSafePackageId`,
`assertSafeTarArchive`, the entire `core/platform/` adapter layer, and
similar are implementation details that exist to support the Stable
surfaces above - they can be refactored, renamed, or removed at any time
without that counting as a breaking change, as long as the Stable
surfaces they support keep behaving identically.

## What this means in practice for RC1 and beyond

- Every fix and bug this sweep found and fixed (the `check --json`
  hang, the `package analyze` family, the two `--json`-empty-result
  bugs) touched only **Internal** implementation (`mapWithConcurrency`
  usage, shell-out timeouts, output-ordering inside a command handler) -
  none of it changed a Stable surface's contract. That's exactly the
  category of change this freeze is meant to keep unblocked.
- The one deliberate exception carved out above is `--json` payload
  *shape*, marked Experimental specifically so a future schema
  publication effort isn't constrained by field names that were never
  actually designed as a contract.
- `ai *` stays Experimental on purpose - this is where post-RC1
  iteration should still be free to happen without triggering a major
  version bump.
