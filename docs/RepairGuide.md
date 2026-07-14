# Repair Guide

How `devforgekit repair` and `devforgekit compatibility repair` detect,
plan, and safely fix environment issues.

## Two repair systems

DevForgeKit has two complementary repair pipelines:

1. **Intelligent Repair Engine** (`devforgekit repair`) — a multi-stage
   pipeline that scans 13 subsystems, generates a dependency-ordered plan
   with risk assessment, executes repairs with safety checks and per-repair
   rollback, verifies results, and records a quality score.

2. **Compatibility Repair** (`devforgekit compatibility repair`) — a
   focused two-step pipeline for compatibility issues only:
   `scanCompatibility() → planRepair() → executeRepairPlan()`

## The Intelligent Repair Engine pipeline

```text
scanIssues() → planRepairs() → [dryRunPlan()] → executeRepairs() → verifyRepairs()
     (scan)        (plan)          (preview)          (execute)          (verify)
```

### Scan

13 scanners probe every DevForgeKit subsystem:

- **Compatibility Engine** — cross-tool/version compatibility
- **PATH** — missing/duplicate directories
- **Broken Symlinks** — dead links in bin directories
- **Docker** — daemon not running
- **Disk Space** — usage > 90%
- **Git** — missing user.name/user.email
- **Workspaces** — invalid workspace configs
- **Plugins** — failed plugin validation
- **Configuration** — invalid AI provider
- **Homebrew** — `brew doctor` issues
- **SSH** — missing keys
- **Caches** — oversized cache directories
- **CLI Install** — the CLI's own global symlink/deps/failed packages from the last `bootstrap.sh` run

### Plan

`planRepairs(issues)` produces:
- Dependency-ordered repair list (topological sort with cycle protection)
- Aggregate **risk level** (none/low/medium/high)
- **Categories affected** list
- **Files affected** list
- **Packages affected** list
- Estimated time and restart requirements

### Dry Run (v2.1.6+)

```bash
./devforgekit repair run --dry-run       # preview the full pipeline
./devforgekit repair plan --dry-run      # preview just the plan
```

Dry run shows every action's type, command/package, files affected, and
risk level — without executing anything.

### Execute

`executeRepairs(plan)` runs each repair in order:

1. **Safety check** — `validatePrerequisites(action)` verifies platform
   support, package manager availability, and registry existence
2. **User confirmation** — each repair is confirmed (unless `--yes`)
3. **File backup** — files that will be modified are backed up for
   per-repair rollback
4. **Execution** — structured action types:
   - `shell` — runs a shell command
   - `install` — installs a registry package
   - `uninstall` — uninstalls a conflicting package
   - `compatibility` — delegates to compatibility/repair.js
   - `component-repair` — runs a package's registry-declared `repair` command
   - `manual` — reported, never executed
5. **Progress** — `onProgress` callback fires with index, total, status,
   title, and elapsed time

### Verify

Post-repair verification runs:
- Compatibility scan
- Health score calculation
- Workspace validation
- Plugin validation
- Configuration validation
- Optional benchmark comparison

### Repair Intelligence (v2.1.6+)

Every issue carries a structured explanation with Problem / Impact /
Fix / Risk / Estimated Time. Instead of just "Repairing PATH...",
the user sees:

```
Problem
  Duplicate PATH entries detected.
Impact
  Commands may resolve inconsistently.
Fix
  Duplicate entries will be removed.
Risk
  None
Estimated time
  2 seconds
Rollback
  Available
```

```bash
./devforgekit repair explain              # explain all issues
./devforgekit repair explain --plan       # explain the full plan
./devforgekit repair explain --json       # machine-readable
```

### Quality Score (v2.1.6+)

`computeQualityScore(execution, verification)` produces a 0-100 score:
- **Success rate** — percentage of repairs that succeeded
- **Safety bonus** — +5 if rollback snapshot was created
- **Verification bonus** — +5 if health ≥ 90, +3 if ≥ 70
- **Skip penalty** — -2 per skipped repair

Grade: A (≥90), B (≥80), C (≥70), D (≥60), F (<60)

### Rollback

Three levels of rollback:

1. **Full snapshot** — `devforgekit repair rollback <snapshotId>` restores
   the entire environment snapshot created before repairs
2. **Per-repair record** — `devforgekit repair rollback-repair <repairId>`
   restores file backups from a specific repair record
3. **Per-repair result** — `rollbackRepairResult(result)` restores
   individual files backed up during each repair (API level)

```bash
./devforgekit repair rollback-list                    # list rollback points
./devforgekit repair rollback-repair <id> --preview   # preview rollback
./devforgekit repair rollback-repair <id>             # execute rollback
./devforgekit repair rollback-repair <id> --snapshot  # use full snapshot
./devforgekit repair rollback-repair <id> -y          # skip confirmation
```

### History

```bash
./devforgekit repair history           # list records with risk, quality
./devforgekit repair history --clear   # delete all records
./devforgekit repair history --search "git"       # search by keyword
./devforgekit repair history --filter-risk high   # filter by risk
./devforgekit repair history --filter-category Git # filter by category
./devforgekit repair history --filter-status failed # filter by status
./devforgekit repair history --sort fixed         # sort by fixed count
./devforgekit repair history --limit 5            # limit results
./devforgekit repair history --json               # JSON output
./devforgekit repair export <id>       # export as json/markdown/html/csv
./devforgekit repair delete <id>       # delete one record
```

Each history record includes: platform, user, risk level, categories
affected, quality score, and rollback snapshot ID.

### Performance Audit (v2.1.6+)

```bash
./devforgekit repair benchmark          # benchmark scan, plan, history
./devforgekit repair benchmark -n 5     # 5 iterations
./devforgekit repair benchmark --json   # JSON output
```

Benchmarks each pipeline stage (registry load, scan, plan, history
load) and provides recommendations for slow stages.

### TUI Repair Page (v2.1.6+)

Press `R` in the dashboard to access the Repair Engine page. Features:

- **Overview tab** — summary cards (issues, repairs, risk, quality,
  history), recent runs, execution results
- **Issues tab** — navigable issue list with severity glyphs, risk
  filter (`f` key), detail panel with Problem/Impact/Fix
- **Plan tab** — structured plan with repair order, risk, time,
  rollback, files/packages affected
- **History tab** — navigable history list with quality scores
- **Detail panel** — full metadata for selected issue/plan/history
- **Keyboard shortcuts** — `s` scan, `p` plan, `r` repair, `d` dry-run

## Repair Categories (v2.1.6+)

Every issue is classified into one of 27 categories:

| Category | Label | Description |
|----------|-------|-------------|
| `compatibility` | Compatibility | Cross-tool version issues |
| `path` | PATH | PATH directory problems |
| `symlink` | Symlink | Broken symbolic links |
| `docker` | Docker | Docker daemon issues |
| `disk` | Disk | Disk space warnings |
| `git` | Git | Git configuration |
| `workspace` | Workspace | Invalid workspaces |
| `plugins` | Plugins | Plugin validation |
| `ai` | AI | AI provider config |
| `homebrew` | Homebrew | Homebrew health |
| `ssh` | SSH | SSH key issues |
| `cache` | Cache | Cache cleanup |

Filter by category: `./devforgekit repair scan --category git`

## Risk Levels (v2.1.6+)

| Level | Description |
|-------|-------------|
| `none` | No changes (informational only) |
| `low` | Additive/idempotent (install, config set) |
| `medium` | Modifies existing config or uninstalls |
| `high` | Destructive or irreversible |

## Compatibility Repair (two-step pipeline)

```text
scanCompatibility()  ->  planRepair()  ->  executeRepairPlan()
     (find issues)        (decide what           (do it)
                           to do about them)
```

`core/compatibility/repair.js`'s `planRepair(scanResult)` reads the
*structured* fields `engine.js` attaches to each issue (`dependency`,
`conflictWith`, `variantConflict`, `recommendation`) - never regexes an
English sentence back apart - and turns each actionable one into exactly
one of:

| Action type | From | What it does |
| --- | --- | --- |
| `install` | A `requires` issue naming a missing dependency | `devforgekit component install <dep>` |
| `shell` | A `deprecated`/version-mismatch issue with a `Run: <cmd>` recommendation | Runs that command (usually the dependency's own `update`) |
| `conflict` | A `conflicts`/`conflictWith` issue | Uninstalls one of the two conflicting packages - **only after confirmation** |
| `manual` | A `variantConflict` issue | Never executed - see below |

## Never destructive without confirmation

`executeRepairPlan(actions, { assumeYes })` only ever removes anything
(`conflict` actions) after `lib/prompts.js`'s `confirm()` returns true -
unless `assumeYes` is explicitly set (`--yes`/`-y` on the CLI, or the
existing `DEV_SETUP_ASSUME_YES=1` convention this platform already uses
everywhere else). `install`/`shell` actions are additive/idempotent and
don't need confirmation, matching how `component install`/`update` already
behave without one.

## Why `variantConflict` actions are never auto-repaired

A `variantConflicts` finding (see [RuleSchema.md](RuleSchema.md)) means two
of one package's own install variants (e.g. `docker`'s `docker-desktop`
and `colima`) both appear installed. The registry only ever tracks *one*
chosen variant per package - there's no single "the package to uninstall"
to act on, so this always surfaces as a `manual` action: reported, never
executed. Resolving it means manually choosing which backend to keep
(e.g. `brew uninstall colima`) outside DevForgeKit's own uninstall path.

## Usage

```bash
./devforgekit repair                          # full pipeline (scan → plan → repair → verify)
./devforgekit repair run --dry-run            # preview without changes
./devforgekit repair run --yes                # skip confirmation prompts
./devforgekit repair scan                     # scan only
./devforgekit repair scan --category git      # scan specific category
./devforgekit repair plan                     # generate plan
./devforgekit repair plan --dry-run           # preview plan
./devforgekit repair explain                  # explain all issues
./devforgekit repair explain --plan           # explain the full plan
./devforgekit repair verify                   # post-repair verification
./devforgekit repair history                  # list repair records
./devforgekit repair history --clear          # clear all records
./devforgekit repair history --search "git"   # search history
./devforgekit repair history --filter-risk high # filter by risk
./devforgekit repair rollback-list            # list rollback points
./devforgekit repair rollback-repair <id>     # rollback a repair
./devforgekit repair rollback-repair <id> --preview # preview rollback
./devforgekit repair rollback <snapshotId>    # roll back to snapshot
./devforgekit repair benchmark                # performance audit
./devforgekit repair export <id> -f json      # export a record
./devforgekit repair delete <id>              # delete a record
```

Compatibility repair (scoped to installed components):

```bash
./devforgekit compatibility repair                 # plan + execute
./devforgekit compatibility repair flutter dart      # scoped
./devforgekit compatibility repair --dry-run         # plan only
./devforgekit compatibility repair --yes             # skip prompts
```

## In the Dashboard

The Compatibility page's `F` key runs the same `planRepair`/
`executeRepairPlan` pipeline, but always through the suspend/resume
handoff (`suspend()`, the same mechanism the Doctor page uses to run
`scripts/doctor.sh`) - a `conflict` action's confirmation prompt needs the
real terminal, which Ink's raw-mode input would otherwise fight over.
