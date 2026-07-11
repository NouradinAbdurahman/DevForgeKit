# Command Safety Classification

## The rule

**A command without an explicit mutating verb must never modify the user's machine.**

`doctor`, `check`, `audit`, `verify`, `lint`, `validate`, `stats`, `graph`,
`info`, `list`, `export`, `search`, `diff`, `history`, `inspect`, `explain`
are read-only words. A user who runs one of these should never need to
wonder "wait, did that just install/remove/change something?" If a
command needs to mutate the machine, either its own name says so
(`install`, `uninstall`, `repair`, `regenerate`, `switch`, `restore`,
`create`, `delete`, `use`, `set`) or mutation is gated behind an explicit
flag (`--fix`, `--install`, `--yes`) that the bare invocation does not
trigger.

```text
doctor              read-only
doctor --fix        mutates
verify               read-only
verify --install     mutates
repair scan/plan      read-only (scan+plan only)
repair run             mutates (behind a real interactive confirm, or --yes)
install                mutates (name says so)
uninstall               mutates (name says so)
```

## Why this document exists

While building the backward-compatibility test matrix for the v3.0
release, `devforgekit registry verify` was run against a real
development machine under the assumption that "verify" meant read-only
(matching `registry audit`/`registry lint`/`registry doctor`, all
genuinely read-only). It wasn't: `registry verify`'s actual job was
"attempt install or validate," and it began attempting real package
installs before the mistake was caught (see the entry below - the
install attempts failed before anything persisted, so no lasting
system change resulted, but the near-miss triggered this audit).

Five parallel reviews then read every command file in `cli/src/commands/`
(38 files, every subcommand) and traced actual function calls - not
descriptions or names - to build the table below and find every other
place a read-sounding name might hide a mutation.

## Confirmed violations found and fixed

### 1. `registry verify` - installed real software by default

**Before:** `verifyPackage()` (`core/installAudit.js`) checked whether a
package validated as already installed; if not, it unconditionally
called `installWithDetails()` - a real `brew`/`npm`/`pip`/`cargo`/etc.
install - for every one of the 261 registry packages not already
present. No flag existed to opt out.

**After:** `verifyPackage`/`verifyAllPackages` take an `attemptInstall`
parameter, default `false`. A package that isn't already installed now
reports a new, honest `NOT_INSTALLED` status (never attempting to
install it) unless the caller explicitly passes `attemptInstall: true`.
`devforgekit registry verify` gained a `--install` flag - the CLI
default is now fully read-only; `--install` is required to opt into
real installs, matching every other command in this table.

Regression test: `test/installAudit.test.js` proves this with a
synthetic package whose install step writes a canary file - the canary
must never appear unless `attemptInstall: true` is explicitly passed
(and a companion test proves the canary methodology itself works by
showing it *does* appear when explicitly requested).

### 2. `workspace benchmark <name>` - switched live machine identity by default

**Before:** `benchmarkWorkspace()`'s default operation list included
`switch` and `restore`, both of which call `switchToWorkspace()`/
`rollbackToSnapshot()` for real: real `git config --global` writes, real
`~/.ssh/config` Host block rewrites, real Docker/Kubernetes context
switches, real cloud CLI profile switches. A user running
`devforgekit workspace benchmark work-project` to "see how fast things
are" would have their live git/SSH/Docker identity silently switched to
`work-project`'s configuration, mid-benchmark, with no flag needed.
("benchmark" isn't even in the read-only-word list above - it's simply
not a word anyone would expect to mutate anything.) The same run also
left permanent, uncleaned snapshot files behind (a separate bug: the
cleanup loop after the `snapshot` operation was an empty no-op).

**After:** the default operation set is now `metadata`/`health`/
`verify`/`diff` - the four operations confirmed to make zero writes and
zero live-state changes. `snapshot`/`switch`/`restore`/`bundleExport`/
`bundleImport` remain available, opt-in only, via `--ops
snapshot,switch,...`. The snapshot cleanup loop now actually deletes
what it created.

Regression tests in `test/workspace-excellence.test.js` prove: the
default op list excludes `switch`/`restore`; explicitly-requested
mutating ops still work; and the `snapshot` operation leaves zero
snapshots behind after benchmarking.

## Lower-severity findings (not fixed - reasoning below)

A few commands write to an app-owned, TTL-bound internal cache
(`~/.devforgekit/dev-graph/cache.json`, package-intel cache,
AI-provider model list cache, local AI event log) even when their name
is a read-only word (`graph verify/stats/search/export/...`, `package
info/search/orphan/...`, `ai model list`, `ai explain/review/...`).
These do not install/remove software, do not edit user configuration
(`~/.config/devforgekit/config.yaml`), do not touch git/SSH/Docker/
Kubernetes/cloud identity, and do not start/stop services - the actual
categories of "modifying the user's machine" this audit's rule is about.
They're the same class of side effect as a browser writing to its own
cache on a page view, or `git status` touching `.git/FETCH_HEAD`.
Documented here rather than "fixed," since removing internal caching
from these commands would be a real performance regression for a
side effect that doesn't touch anything the user would recognize as
their machine's state. `ai key export` also always writes a plaintext
keys file by default (name says "export," so not a naming violation,
but worth knowing since it's a security-sensitive default).

## Confirmed clean (no violation)

`doctor`, `env doctor`/`env validate`, `repair scan`/`plan`/`verify`/
`explain-issues`/`benchmark`, `snapshot list`/`inspect`/`verify`/`diff`
(extract to a temp dir, always cleaned up), `search`, `workspace verify`/
`health`/`diff`/`metadata`, `plugin doctor`/`validate`/`quality`,
`compatibility scan`/`check`/`explain`/`graph`/`update`, `registry
doctor`/`audit`/`lint`, `component doctor`/`info`/`validate`, `check`,
`stats`, `validate` (the root command) - each traced to confirm zero
writes, zero installs, zero removes, zero config edits under default
flags.

## Full classification table

Legend: **R**=reads filesystem, **W**=writes filesystem (excluding the
internal-cache class discussed above, called out per-row instead),
**I**=installs software, **X**=removes software, **C**=edits
`~/.config/devforgekit` or similar, **N**=network access, **S**=requires
sudo (in the underlying shell command), **CI**=safe to run unattended in
CI with default flags (no `--yes`/`--fix`/`--install`).

### `ai`

| command | R | W | I | X | C | N | S | CI | note |
|---|---|---|---|---|---|---|---|---|---|
| `ai chat` | T | F | F | F | F | T | F | F | interactive REPL |
| `ai doctor` | T | F | F | F | F | T | F | F | read-only scan + AI narration |
| `ai explain/review/analyze/summarize/optimize/compare` | T | T* | F | F | F | T | F | F | *local event-log write only |
| `ai generate [prompt]` | T | T | F | F | F | T | F | F | scaffolds after confirm (`-y` skips) |
| `ai repair` | T | T | I | X | F | T | F | F | confirm-gated unless `-y` |
| `ai planner <goal>` | T | T | I | F | F | T | F | F | confirm-gated unless `-y` |
| `ai models` / `ai provider list/current` / `ai key list` | T | F | F | F | F | T/F | F | T | read-only |
| `ai providers --check` / `ai health --live` | T | F | F | F | F | T | F | T | network opt-in via flag - correct pattern |
| `ai key export [file]` | T | T | F | F | F | F | F | F | **always writes plaintext keys** by default (see note above) |
| `ai key add/rotate/remove/import/migrate` | T | T | F | F | T | F | F | F | name says mutate |
| `ai model list` | T | T* | F | F | F | T | F | T | *cache write only |
| `ai fix` | T | T | F | F | T | F | F | F | name says mutate |
| `ai history --clear` / `ai stats --clear` | T | T | F | F | F | F | F | F | explicit flag required - correct |
| `ai setup` | T | T | F | F | T | T | F | F | interactive |
| `ai benchmark` | T | T | F | F | F | T | F | F | real API calls |

### `backup` / `clean` / `report` / `restore` / `release` / `self-update` / `update` / `services` / `install`

All named for exactly what they do; all confirmed mutating (or, for
`services status`, read-only). No naming violations.

| command | R | W | I | X | C | N | S | CI | note |
|---|---|---|---|---|---|---|---|---|---|
| `backup` | T | T | F | F | F | T (git push) | F | F | |
| `clean` | T | T | F | T | F | F | F | F | |
| `report` | T | T | F | F | F | F | F | T | |
| `restore` | T | T | F | F | T | F | F | F | |
| `release <bump>` | T | T | F | F | F | T | F | F | |
| `self-update` | T | T | T | F | T | T | F | F | |
| `self-update --dry-run` | T | F | F | F | F | F | F | T | |
| `update` | T | T | T | F | F | T | F | F | |
| `services status` | T | F | F | F | F | F | F | T | |
| `services start/stop/restart` | T | F | F | F | F | F | F | T (changes running service state, not files) | |
| `install` / `bootstrap` | T | T | T | F | T | T | possible | F | |
| `validate` (root) | T | F | F | F | F | F | F | T | |

### `benchmark`, `check`, `collection`, `compatibility`, `component`

| command | R | W | I | X | C | N | S | CI | note |
|---|---|---|---|---|---|---|---|---|---|
| `benchmark quick/full/standard` | T | T (history, `--no-save` opts out) | F | F | F | F | F | F* | |
| `benchmark compare/history/trend/report` | T | F | F | F | F | F | F | T | |
| `benchmark explain [id]` | T | F | F | F | F | T | F | F | |
| `check` | T | F | F | F | F | F | F | T | |
| `collection list/info` | T | F | F | F | F | F | F | T | |
| `collection install <name>` | T | T | T | F | T | T | F | F | |
| `compatibility` / `scan`/`check`/`explain`/`graph` | T | F | F | F | F | F(/T with `--ai`) | F | T | |
| `compatibility repair` | T | T | I | X | F | T | F | F | confirm-gated |
| `compatibility update` | T | F | F | F | F | F | F | T | only validates local YAML, despite "update" |
| `compatibility export <path>` | T | T | F | F | F | F | F | F | path arg is the point |
| `component list/info/doctor/validate` | T | F | F | F | F | F | F | T | |
| `component install/repair/update/reinstall/uninstall` | T | T | varies | varies | T | T | F | F | |

### `config`, `dashboard`, `doctor`, `environment` (`env`), `explain`, `graph`, `info`

| command | R | W | I | X | C | N | S | CI | note |
|---|---|---|---|---|---|---|---|---|---|
| `config get/list` | T | F | F | F | F | F | F | T | |
| `config set <k> <v>` | T | T | F | F | T | F | F | T | |
| `dashboard` | T | F | F | F | F | F | F | F (needs TTY) | |
| `doctor` | T | F | F | F | F | F | F | T | |
| `doctor --fix` | T | T | F | F | T | F | possible | F | |
| `env doctor/validate/list/graph/shells/diff/history` | T | F | F | F | F | F | F | T | |
| `env regenerate` / `env watch` | T | T | F | F | T | F | F | F | named for it |
| `env snapshot create` (default) / `env restore <id>` | T | T | F | F | T* | F | F | F* | *restore only |
| `explain <name>` | T | F | F | F | F | F | F | T | |
| `graph open/search/explain/export/verify/stats/path/impact/conflicts/orphan/focus` | T | T* | F | F | F | F(/T `explain` if AI configured) | F | T | *unconditional 30-min cache write - see "Lower-severity findings" |
| `graph history` | T | F | F | F | F | F | F | T | |
| `graph cache --clear` | T | T | F | F | F | F | F | T | explicit flag |
| `info <name>` | T | F | F | F | F | F(/T `--live`) | F | T | |

### `inventory`, `new`, `package`, `plugin`, `preferences`, `profile`, `recipe`, `registry`

| command | R | W | I | X | C | N | S | CI | note |
|---|---|---|---|---|---|---|---|---|---|
| `inventory` | T | T | F | F | F | F | F | T | writes `reports/*.md` - named for it |
| `new [stack] [name]` | T | T | possible (stack's own CLI) | F | F | possible | possible | F | |
| `new --list/--quality` | T | F | F | F | F | F | F | T | |
| `package analyze/info/search/orphan/duplicates/unused/outdated/impact` | T | T* | F | F | F | F | F | T | *cache write only |
| `package tree/graph/compare/history` | T | F | F | F | F | F | F | T | |
| `package recommend` | T | T* | F | F | F | T | F | F | AI provider call |
| `plugin list/info/validate/quality/doctor` | T | F | F | F | F | F | F | T | |
| `plugin create/build/package/publish` | T | T | F | F | F | F | F | T | scaffolding/packaging, not installing |
| `plugin install <pathOrUrl>` | T | T | T | F | F | T (if URL) | F | F | |
| `plugin run <name> [cmd]` | varies | varies | varies | varies | varies | varies | varies | F | runs an arbitrary plugin script, by design |
| `plugin trust <pubkey>` / `plugin keygen` | T | T | F | F | T | F | F | T | |
| `preferences status` | T | F | F | F | F | F | F | T | |
| `preferences backup/restore` | T | T | F | F | T | F | F | F | |
| `profile list/show/search/publish` | T | F | F | F | F | F | F | T | |
| `profile use <name>` | T | T | F | F | T | F | F | T | named for it |
| `profile install/import` | T | T | T | F | T | T | possible | F | |
| `profile create/export` | T | T | F | F | F | F | F | T | |
| `recipe list/show/search/publish` | T | F | F | F | F | F | F | T | |
| `recipe install/import` | T | T | T | F | T | T | possible | F | |
| `recipe create` | T | T | F | F | F | F | F | T | |
| `registry generate/stats/doctor/audit/lint` | T | F(/T `generate`, named for it) | F | F | F | F | F | T | |
| `registry verify` (default) | T | F | F | F | F | F | F | T | **fixed - see above** |
| `registry verify --install` | T | T | T | F | F | T | possible | F | explicit opt-in |
| `registry format` (default) / `--check` | T | T/F | F | F | F | F | F | T (`--check`) | named for it |

### `repair`, `search`, `snapshot`, `stats`, `theme`, `uninstall`, `workspace`

| command | R | W | I | X | C | N | S | CI | note |
|---|---|---|---|---|---|---|---|---|---|
| `repair scan/plan/verify/explain-issues/benchmark` | T | F | F | F | F | F(/T `explain`) | F | T | |
| `repair run` (default) / `repair install` | T | T | possible | rarely | T | possible | F | F | confirm-gated, `--dry-run`/`--yes` available |
| `repair history/export/delete/clean/rollback-list` | T | T*/F | F | F | F | F | F | T | *only `--clear`/`export -o`/`delete`/`clean` write |
| `repair rollback <id>` / `rollback-repair <id>` | T | T | possible | possible | T | F | F | F | confirm-gated unless `--yes` |
| `search <query>` | T | F | F | F | F | F | F | T | |
| `snapshot create` | T | T | F | F | F | F | F | T | named for it |
| `snapshot restore <archive>` | T | T | T (unless `--skip-packages`) | F | T (unless `--skip-config`) | F | F | F | **no interactive confirm at all** - noted for UX consistency with `repair run`, not a naming violation |
| `snapshot list/inspect/verify/diff` | T | T* | F | F | F | F(/T `explain`) | F | T | *temp-extraction, always cleaned up |
| `snapshot export/delete` | T | T | F | F | F | F | F | T | |
| `stats` | T | F | F | F | F | T (`softwareupdate -l` contacts Apple) | F | T | |
| `theme list` | T | F | F | F | F | F | F | T | |
| `theme use/random/import` | T | T | F | F | T | F | F | T | named for it |
| `theme export [-o]` / `preview`/`gallery` | T | T*/F | F | F | F*/T | F | F | T/F | *only with `-o`; preview/gallery need a TTY |
| `uninstall` | T | T | F | T | T | F | F | F | refuses non-interactive without `--force`/`--yes` |
| `workspace list/show/metadata/search/verify/diff/health/repair-preview` | T | F | F | F | F | F | F | T | |
| `workspace create [--switch]` | T | T | F | F | T | F | F | T (F with `--switch`) | |
| `workspace switch/rollback/delete/rename/clone/import` | T | T | F | F | T | possible | F | F | named for it |
| `workspace repair <name>` | T | T* | F | F | T | F | F | T | *only if dangling refs exist |
| `workspace export <name>` | T | T | F | F | F | F | F | T | |
| `workspace benchmark <name>` (default) | T | F | F | F | F | F | F | T | **fixed - see above** |
| `workspace benchmark --ops switch,restore,snapshot,...` | T | T | F | F | T | possible | F | F | explicit opt-in |
| `workspace compatibility scan` | T | T (appends `scanHistory`) | F | F | T | F | F | T | not misleadingly named (paired with `repair` sibling) |
| `workspace compatibility repair` | T | T | I | X | T | T | F | F | `--dry-run` available |
| `workspace compatibility history` | T | F | F | F | F | F | F | T | |

## How to keep this true going forward

- Adding a new subcommand named with a read-only word (see the list at
  the top)? It must perform zero installs, zero removes, zero config
  edits, and zero live-identity changes (git/SSH/Docker/Kubernetes/cloud
  CLI) under its default invocation - no flags.
- If it needs to do one of those things, either rename it or gate the
  mutating behavior behind an explicit flag whose absence is the
  default (`--fix`, `--install`, `--apply`, `--yes`).
- Add a regression test in the style of `test/installAudit.test.js`'s
  canary-file tests: prove the absence of a real side effect, not just
  that a status field reads a particular string.
