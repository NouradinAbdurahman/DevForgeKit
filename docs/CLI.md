# The `./devforgekit` CLI

`./devforgekit` is the single entry point over the whole platform. Since
Phase 1 (v1.1, see [PlatformArchitecture.md](PlatformArchitecture.md)) it
has two layers:

- **`install`/`bootstrap`** always run `bootstrap.sh` directly (pure bash,
  no Node required - see the "Design" section below for why).
- **Every other command** is delegated to the Node Core CLI under `cli/`
  once `bootstrap.sh` has set it up (`cli/node_modules` present + `node`
  on `PATH`). Until then - or on a machine where that setup was
  skipped/failed - `./devforgekit` falls back to the original bash
  dispatch table (`scripts/*.sh`), so every command keeps working exactly
  as before regardless of whether the Node CLI is available.

```text
./devforgekit install [options]      Full provision (forwards to ./bootstrap.sh)
./devforgekit update                 Upgrade the managed toolchain, restart services
./devforgekit backup                 Capture live config into the repo, commit+push
./devforgekit restore                Restore dotfiles/editors from the repo
./devforgekit check                  Fast PASS/WARNING/FAIL health check
./devforgekit doctor [--fix]         Deep diagnostics + health score
./devforgekit validate                Validate this repo's own scripts/configs
./devforgekit inventory                Generate machine inventory reports
./devforgekit report                    Generate a system report
./devforgekit services <action>          start|stop|restart|status
./devforgekit clean                       Reclaim disk space
./devforgekit release <bump>               patch|minor|major version release
./devforgekit preferences <action>          backup|restore|status
./devforgekit profile <action>                list|show|use|install|create|export|import|search|publish
./devforgekit recipe <action>                   list|show|install|create|import|search|publish - one-command environment workflows (Node CLI only)
./devforgekit config <action>                  get|set|list - configuration (Node CLI only)
./devforgekit component <action>                list|info|install|validate|repair|update|uninstall (Node CLI only)
./devforgekit search <query> [--category/--tag]  search the 261-component registry (Node CLI only)
./devforgekit info <name> [--live]                 rich component info + Manifest Quality Score (Node CLI only)
./devforgekit collection <action>                  list|info|install - curated component bundles (Node CLI only)
./devforgekit registry <generate|stats>             rebuild registry.json/docs, or show analytics (Node CLI only)
./devforgekit stats                                  installed components, disk, outdated, health score (Node CLI only)
./devforgekit plugin <action>                         list|info|run|create|test|build|package|publish|install|trust|keygen (Node CLI only)
./devforgekit new <stack> [name]                        generate a complete project - 17 stacks (Node CLI only)
./devforgekit workspace <action>                        create|list|show|switch|deactivate|delete|rename|clone|search|verify|repair|export|import|rollback|snapshot|env|ssh|git-capture|shell-init (Node CLI only)
./devforgekit self-update [--dry-run]                     Update the entire DevForgeKit platform (alias: upgrade) (Node CLI only)
./devforgekit snapshot <action>                            create|restore|list|inspect|verify|diff|export|delete - environment snapshot & restore (Node CLI only)
./devforgekit benchmark [profile]                           quick|standard|full - measure dev environment performance (aliases: bench, perf) (Node CLI only)
./devforgekit repair <action>                               run|scan|plan|explain|verify|rollback|history|export|delete|clean - intelligent repair engine (aliases: fix, heal) (Node CLI only)
./devforgekit package <action>                              analyze|info|tree|graph|orphan|duplicates|unused|outdated|recommend|impact|search|compare|history|export - package intelligence (aliases: packages, pkg) (Node CLI only)
./devforgekit graph <action>                                 open|search|explain|export|verify|stats|path|impact|conflicts|orphan|focus|history|cache - development environment graph (aliases: env, deps) (Node CLI only)
./devforgekit theme <action>                                 list|use|preview|random|export|import|gallery - TUI theme management (Node CLI only)
./devforgekit uninstall                        Not yet implemented
./devforgekit help                              Show usage
```

## Examples

```bash
./devforgekit install --profile flutter
./devforgekit doctor --fix
./devforgekit profile list
./devforgekit services status
./devforgekit release patch
./devforgekit component list --category devops
./devforgekit component install          # interactive, category-grouped picker
./devforgekit search postgres --category databases
./devforgekit collection install backend  # installs node, postgres, redis, docker, git, vscode
./devforgekit profile install ai            # installs the python-ai + machine-learning collections
./devforgekit profile create                 # interactive profile builder wizard
./devforgekit profile export my-machine       # snapshot what's actually installed
./devforgekit recipe list
./devforgekit recipe install ai-engineer     # install + configure (git/vscode/shell) + verify, one command
./devforgekit recipe show flutter-developer
./devforgekit recipe create                   # interactive recipe builder wizard
./devforgekit info flutter
./devforgekit info flutter --live   # also checks homepage/repository reachability
./devforgekit stats
./devforgekit registry stats
./devforgekit registry audit                  # health scorecard: coverage %, quality, recommendations
./devforgekit plugin list
./devforgekit plugin create my-plugin      # scaffold a new plugin project
./devforgekit plugin test my-plugin
./devforgekit plugin build my-plugin && ./devforgekit plugin package my-plugin
./devforgekit plugin install ./my-plugin-0.1.0.tar.gz
./devforgekit config set editor cursor
./devforgekit registry generate
./devforgekit new --list
./devforgekit new nextjs my-app
./devforgekit new flutter my-app --state riverpod --backend supabase
./devforgekit new express my-api --auth --prisma --swagger --docker
```

## Interactive dashboard

`devforgekit` with **no arguments** opens the full-screen terminal
dashboard (v1.2.3) - a keyboard-driven TUI over the same engine as
every command on this page. `devforgekit dashboard` (alias `ui`) opens
it explicitly, `--page <id>` starts on a specific page, and non-TTY
environments (pipes, CI, `TERM=dumb`, `DEVFORGEKIT_NO_TUI=1`) fall back
to the classic `--help` output.

```bash
devforgekit                       # dashboard on a capable TTY
devforgekit dashboard --page components
devforgekit config set tuiTheme high-contrast   # dark | light | high-contrast | minimal
```

Pages: overview, workspaces (browse/create/switch/verify/snapshot),
components (browse/filter/install with live output), profiles, recipes
(with step preview), the 17-stack project generator wizard, plugins,
doctor, updates, inventory, configuration, session logs, help, about -
plus global `/` search across all of them. Full
reference, keyboard model, and design notes in [TUI.md](TUI.md).

## Components, collections, profiles, and search

The component registry (`registry/`, see
[PlatformArchitecture.md](PlatformArchitecture.md) section 3) ships 261
components across 35 categories today (languages, package managers,
databases, containers, Kubernetes, cloud, DevOps, editors, fonts,
terminals, browsers, AI, utilities, security, game development, design,
networking, monitoring, media, embedded, CI/CD, build systems, testing,
package signing, code quality, documentation, API development, web,
desktop, Apple development, Android, reverse engineering, plus the
original frontend/backend/mobile). Every component also carries the
Package Quality System's metadata (`documentation`, `architectures`,
`stability`, `lastVerified`, `ciVerified`) and an objective **Manifest
Quality Score** out of 100 (ten checks: schema validity, homepage/
repository present-or-reachable, license, install/verify/uninstall
tested, rollback available, health check, documentation) - `devforgekit
info <name>` shows the full breakdown; add `--live` to actually verify
homepage/repository reachability over the network (slower, opt-in;
`devforgekit registry stats` reports the registry-wide average).
`component install <name...>`,
`collection install <name>`, and `profile install <name>` all resolve
dependencies automatically (a component's `dependencies` field is walked
transitively - e.g. installing `flutter` also resolves `dart` and, via
`android-studio`, `java`) and skip anything whose `validate` command
already passes; each real install reports its live elapsed time
("docker installed in 8.2s" - measured, not a stored guess).
**Profiles** (50 of them, e.g. `fullstack`, `ai`,
`cybersecurity`, `startup`) are the richest layer: each composes one or
more collections plus extra components plus optional config `settings`
that get applied to `~/.config/devforgekit/config.yaml` after install.
`profile create` walks an interactive wizard (editor/browser/terminal/
cloud/AI/languages/databases/containers/fonts) to build a personal one;
`profile export`/`import` snapshot and reproduce a machine's actual
installed state. Run `./devforgekit component list`,
`./devforgekit collection list`, `./devforgekit profile list`, or
`./devforgekit search <term>` to browse; `docs/Registry.md` (regenerated
by `registry generate`) is a static, browsable catalog of the same data.

## Recipes

`./devforgekit recipe` (v1.2.1, see
[PlatformArchitecture.md](PlatformArchitecture.md)'s Recipe system
section and [Recipes.md](Recipes.md)) is a lighter-weight, opinionated
sibling of a profile: it resolves the exact same collections/components
through the same installer (`profile install`'s `runInstallPlan`), then
adds two things a profile doesn't have - a `configure` step (cross-cutting
dotfile/environment restoration: `git`/`vscode`/`cursor`/`shell`/`mise`,
the same functions `scripts/restore.sh` already calls) and a `verify`
step (runs every resolved component's health check and reports a
PASS/FAIL summary). One command replaces the "install X, install Y,
configure Z, verify everything" checklist:

```bash
./devforgekit recipe list                    # 8 built-in recipes: ai-engineer, flutter-developer, backend-developer,
                                              # devops-engineer, cybersecurity-lab, game-developer, ml-engineer, embedded-engineer
./devforgekit recipe show ai-engineer         # resolved component list + configure/verify steps
./devforgekit recipe install ai-engineer      # install -> configure -> apply settings -> verify
./devforgekit recipe install ai-engineer --skip-configure --skip-verify
./devforgekit recipe create                    # interactive wizard (category-grouped component picker)
./devforgekit recipe import ./my-recipe.yaml   # install an arbitrary recipe file, no registration needed
./devforgekit recipe search llm
```

Recipes are discovered the same two-root way profiles are - the repo's
shipped `registry/recipes/` plus a user's own
`~/.config/devforgekit/recipes/` (`recipe create` output) - and validated
against `registry/schema/recipe.schema.json`, including the
referential-integrity pass (`registry generate`/`registry stats` count
and validate recipes alongside packages/collections/profiles). `recipe
publish` is a deliberate, honest stub today, same as `profile publish` -
see the Plugin SDK section below for why.

## Project Generator

`./devforgekit new` (v1.2.2, see
[PlatformArchitecture.md](PlatformArchitecture.md) section 8 and
[ProjectGenerator.md](ProjectGenerator.md)) generates a complete,
ready-to-code project for one of 17 stacks - not a copy of a static
folder from `templates/`, but real files assembled per stack, scaffolded
through the stack's own official CLI where one exists:

```bash
./devforgekit new --list                                # every supported stack
./devforgekit new                                         # interactive: pick a stack, then a name
./devforgekit new nextjs my-app                            # TypeScript + Tailwind + shadcn/ui + Docker + CI
./devforgekit new flutter my-app --state riverpod --backend supabase
./devforgekit new express my-api --auth --prisma --swagger --docker
```

Flutter, Next.js, React, React Native, Expo, NestJS, Django, Laravel,
Spring Boot, ASP.NET, and Tauri scaffold through their stack's official
CLI (`flutter create`, `create-next-app`, `django-admin`, ...) or, for
Spring Boot, the Spring Initializr API - so a missing prerequisite (e.g.
`flutter`) fails fast with an actionable message before anything runs.
Express, FastAPI, Go Fiber, Rust Axum, and Electron are fully
hand-written - no external CLI needed. Any stack-specific option not
passed as a flag (state management, auth, Docker, ...) is prompted for
interactively. Full per-stack table in
[ProjectGenerator.md](ProjectGenerator.md).

Project Generator Excellence (v2.1.2): project names are validated
(syntax, Windows-reserved device names, existing directory) before
anything is invoked; `--license mit|apache-2.0|gpl-3.0|none` (prompted if
omitted, defaults to MIT) is applied to every stack from one place;
real, registry-backed companion tools are shown before scaffolding
(`recommends`); `devforgekit new --list`/`--quality` show each stack's
Generator Quality Score (Documentation/Architecture/Testing/CI/Docker/
Editor Support/Validation/Examples/Cross Platform); and generation ends
with a structured summary read back from the real output on disk, not
assumed from what was requested. See
[ProjectGenerator.md](ProjectGenerator.md)'s "Project Generator
Excellence" section.

## Plugin SDK

`./devforgekit plugin` covers the full local lifecycle - create, test,
build, package, publish, install - matching the flow a plugin author
actually runs (see [PlatformArchitecture.md](PlatformArchitecture.md)
section 4 for the full design):

```bash
./devforgekit plugin create my-plugin           # scaffold plugin.yml, commands/, hooks/, tests/, README.md
./devforgekit plugin test my-plugin              # validate + run tests/*.sh, PASS/FAIL score
./devforgekit plugin build my-plugin             # regenerate README.md, write plugin.lock.json
./devforgekit plugin package my-plugin           # tar.gz + SHA-256 + Ed25519 signature
./devforgekit plugin publish my-plugin-0.1.0.tar.gz --to ~/shared-plugins
./devforgekit plugin install ./my-plugin-0.1.0.tar.gz
./devforgekit plugin install https://example.com/my-plugin-0.1.0.tar.gz
./devforgekit plugin trust ~/Downloads/someone-elses-key.pub
./devforgekit plugin keygen                       # (re-)generate this machine's signing key
```

Three things worth being precise about, since the words "sandbox",
"signed", and "publish" can oversell what's actually implemented:

- **Sandbox** means a configurable execution timeout (`timeoutMs`,
  default 30s, `SIGTERM` on expiry) - resource/time isolation, not a
  security boundary. A plugin script has the same filesystem/network
  access as the user running it.
- **Signed** means real Ed25519 signatures (Node's built-in `crypto`),
  but the trust model is local and explicit: your own key is always
  trusted; anyone else's requires `plugin trust <their.pub>` first.
  There is no certificate authority.
- **Publish** stages a signed, checksummed archive into a directory
  (default `~/.devforgekit/published-plugins/`) - useful for
  self-hosting, but there is no hosted marketplace or `plugin search`
  yet; `plugin install` only accepts a path or URL you already have.

`plugin install` always verifies the SHA-256 checksum (hard failure on
mismatch, never just a warning) and warns + prompts for confirmation on
an unsigned or untrusted-signature package unless `-y`/
`DEV_SETUP_ASSUME_YES=1` is set.

## Workspace Manager

`./devforgekit workspace` (v1.2.4, see
[PlatformArchitecture.md](PlatformArchitecture.md) section 21 and
[WorkspaceManager.md](WorkspaceManager.md)) makes an isolated per-project
environment - git identity, SSH host identities, environment variables
and secrets, Docker/Kubernetes/cloud context, and shell aliases/
functions/PATH - a single switchable unit instead of something rebuilt
by hand every time you context-switch between clients or projects:

```bash
./devforgekit workspace create acme-backend --from-current --switch  # seed from what's live now
./devforgekit workspace switch acme-backend                          # applies everything the workspace declares
./devforgekit workspace verify                                       # PASS/WARNING/FAIL across every subsystem
./devforgekit workspace snapshot create acme-backend -m "before upgrading node"
./devforgekit workspace rollback acme-backend <snapshotId>            # safety snapshot first, then restores (+ re-applies if active)
./devforgekit workspace export acme-backend ./backups                # portable .tar.gz, secrets never included
./devforgekit workspace import ./backups/acme-backend-workspace.tar.gz --name acme-backend-2
./devforgekit workspace env set acme-backend API_KEY sk-... --secret # AES-256-GCM at rest
./devforgekit workspace ssh add-identity acme-backend --provider github --alias github.com-acme
```

Switching only ever touches what a workspace actually declares (no
`docker` section configured means Docker is left alone, not cleared),
and only ever does what the real underlying tool supports - Docker/
Kubernetes context switching requires the context to already exist
locally, cloud provider switching runs `AWS_PROFILE`/
`GOOGLE_CLOUD_PROJECT`/`gcloud config set project` where that concept
exists and stays a recorded reference for Azure otherwise. `workspace
verify` and the dashboard's Workspaces page (`w`) share the identical
PASS/WARNING/FAIL engine `doctor`/`check` already standardize on.
Secrets are encrypted at rest with a machine-local AES-256-GCM key (not
a multi-user vault); portable export/import bundles deliberately never
include secret values or snapshot history, and importing on a machine
whose registry doesn't have every referenced profile/recipe/component
auto-repairs (drops + reports) the dangling references rather than
producing a document that can never load. Full schema, subsystem
behavior, and the honest multi-machine-sync scoping in
[WorkspaceManager.md](WorkspaceManager.md).

## Compatibility Engine

`./devforgekit compatibility` (v1.2.5, see
[CompatibilityEngine.md](CompatibilityEngine.md)) validates whether
installed tools actually work *together* - not just whether each is
individually installed:

```bash
./devforgekit compatibility                        # scan everything currently installed
./devforgekit compatibility scan flutter dart        # or a specific set (--profile/--recipe/--workspace also work)
./devforgekit compatibility check flutter dart        # like scan, nonzero exit on CRITICAL/UNSUPPORTED (for CI)
./devforgekit compatibility explain flutter            # per-requirement ✓/✗ breakdown
./devforgekit compatibility repair --dry-run           # preview install/upgrade/removal actions
./devforgekit compatibility graph                       # dependency graph: missing/circular/duplicate findings
./devforgekit compatibility export ./report.md          # --format md|html|json|pdf (pdf = PDF-ready Markdown)
```

Every scan reports a 5-tier verdict - Healthy/Warning/Critical/
Unsupported - where a Critical or Unsupported finding always wins
regardless of the numeric score. It's wired into `doctor`, `recipe
install`/`profile install` (a pre-install check + displayed score), the
Project Generator (opt-in per stack), `workspace compatibility scan/
repair/history`, and a dashboard page (`m`). Repair only ever removes a
conflicting package after explicit confirmation. Full rule format in
[RuleSchema.md](RuleSchema.md), the shipped rules in
[CompatibilityRules.md](CompatibilityRules.md), and the repair
engine's safety rules in [RepairGuide.md](RepairGuide.md).

## AI Development Assistant

`./devforgekit ai` (v1.3.0, see [AIAssistant.md](AIAssistant.md)) reasons
over what DevForgeKit already knows about this machine through a unified
provider abstraction over OpenAI/Anthropic/Gemini/Groq/OpenRouter/Ollama/
LM Studio:

```bash
./devforgekit ai setup                          # guided provider setup (provider, key, model in one flow)
./devforgekit config set aiProvider ollama   # pick a provider once (or --provider per command)
./devforgekit ai doctor                       # plain-language summary/reason/fix/estimatedTime/risk
./devforgekit ai chat                          # interactive, grounded in real installed tools/compatibility/workspace/git status
./devforgekit ai generate "A REST API with JWT using FastAPI and PostgreSQL"   # maps onto a real Project Generator stack
./devforgekit ai planner "I want to become a backend engineer"                 # maps onto real registry collections/recipes/components
./devforgekit ai repair                        # AI-narrated compatibility repair, same confirmation gate as 'compatibility repair'
./devforgekit ai providers --check             # every provider's configuration + live reachability
./devforgekit ai compare pnpm npm              # compare two real components/stacks, grounded only in their real data
./devforgekit ai health [--live]               # one AI Health Score (0-100%) with a per-check breakdown
./devforgekit ai status                        # complete AI config status (provider, model, credentials, validation)
./devforgekit ai fix                           # auto-fix AI configuration issues
```

With no provider configured (the default), every subcommand prints a
clear, actionable message instead of crashing or fabricating a response.
Every provider client is a real REST client; `ai generate`/`ai planner`
only ever select from real Project Generator stacks / real registry
entries, never invented ones, and `ai repair` never removes a conflicting
package without confirmation. AI Assistant Excellence (v2.1.3) added the
Health Score, `ai compare`, a broader context engine (real platform info,
generator stacks, recent AI memory), and fixed a real bug where no
provider client ever set its `supportsStreaming` capability flag despite
`ai benchmark` reading it. Full architecture, the provider wire formats,
and the honest-scoping notes in [AIAssistant.md](AIAssistant.md)'s "AI
Assistant Excellence" section, [ProviderAPI.md](ProviderAPI.md),
[ContextEngine.md](ContextEngine.md), [MemorySystem.md](MemorySystem.md),
and [PromptLibrary.md](PromptLibrary.md).

## Self-Update

`./devforgekit self-update` (v1.3.1, alias: `upgrade`) updates the
entire DevForgeKit platform in one command:

```bash
./devforgekit self-update                # git pull + npm install + config migration + plugin updates + changelog
./devforgekit self-update --dry-run       # preview without making changes
./devforgekit self-update --skip-plugins  # skip user plugin updates
./devforgekit self-update --skip-npm      # skip npm install
```

Full rollback (git reset + config restore) on any step failure.

## Environment Snapshot & Restore

`./devforgekit snapshot` (v1.3.2) captures the entire development
environment into a portable `.dfk` archive and restores it on another
machine:

```bash
./devforgekit snapshot create                         # capture current environment
./devforgekit snapshot restore ./env-2025-07-06.dfk   # restore on another machine
./devforgekit snapshot list                            # list all snapshots
./devforgekit snapshot inspect ./env.dfk               # detailed metadata
./devforgekit snapshot verify ./env.dfk                # validate integrity
./devforgekit snapshot diff old.dfk new.dfk            # compare two snapshots
./devforgekit snapshot export <id> ./backups           # copy to another directory
```

Secrets are never exported; `missing-secrets.md` lists all required keys.

## Benchmark Engine

`./devforgekit benchmark` (v1.3.3, aliases: `bench`, `perf`) measures
development environment performance using real developer workloads:

```bash
./devforgekit benchmark quick      # ~10-20s: CPU, memory, disk, git, node, shell
./devforgekit benchmark standard   # ~30-60s: + docker, flutter, python, databases
./devforgekit benchmark full       # ~2-5min: + project generation
./devforgekit benchmark compare    # compare latest two results
./devforgekit benchmark history    # list all past results
./devforgekit benchmark explain    # AI-powered analysis (requires AI provider)
./devforgekit benchmark export <id> --format markdown
```

## Intelligent Repair Engine

`./devforgekit repair` (v1.3.4, aliases: `fix`, `heal`) is a multi-stage
diagnostic and repair platform: Scan → Analyze → Plan → Repair → Verify.

```bash
./devforgekit repair               # full pipeline: scan, plan, rollback snapshot, repair, verify
./devforgekit repair scan          # 13 scanners across all subsystems
./devforgekit repair plan          # ordered repair plan with dependency-aware sorting
./devforgekit repair explain       # AI-powered root cause analysis
./devforgekit repair verify        # post-repair verification
./devforgekit repair rollback <id> # restore pre-repair state
./devforgekit repair history       # list all past repair records
```

## Package Intelligence & Analytics

`./devforgekit package` (v1.3.5, aliases: `packages`, `pkg`) analyzes
every installed development tool:

```bash
./devforgekit package analyze       # scan all packages, build metadata profiles
./devforgekit package info <name>   # complete profile for a single package
./devforgekit package tree [name]   # dependency tree
./devforgekit package graph [name]  # dependency graph (text/DOT/Mermaid)
./devforgekit package orphan        # packages with no reverse deps or usage
./devforgekit package duplicates    # duplicate runtimes and tool claims
./devforgekit package outdated      # packages with newer versions available
./devforgekit package recommend     # AI-powered recommendations
./devforgekit package impact <name> # removal impact assessment
./devforgekit package search [query] # search with filters
./devforgekit package history       # list past analysis records
./devforgekit package export --format json
```

## Development Environment Graph

`./devforgekit graph` (v1.3.6, overhauled for Environment Graph
Excellence in v2.1.4 - see [EnvironmentGraph.md](EnvironmentGraph.md),
aliases: `env`, `deps`) builds a complete visual model of the developer's
environment as an interactive dependency graph, connecting every
DevForgeKit subsystem - registry packages, compatibility rules, Project
Generator stacks, profiles/recipes/collections, workspaces, plugins, and
repair history:

```bash
./devforgekit graph                 # build and display the graph (default: open)
./devforgekit graph search react    # search nodes by name/type/description
./devforgekit graph explain node    # AI-powered explanation of a node, grounded only in real graph data
./devforgekit graph export mermaid  # json/markdown/html/dot/mermaid/svg/tree/plantuml
./devforgekit graph verify          # check graph integrity
./devforgekit graph stats           # node/edge counts, depth, orphans, cycles, category/platform/architecture distribution
./devforgekit graph path node1 node2  # shortest path between two nodes
./devforgekit graph impact node     # everything affected by removing a node - including affected generator stacks and compatibility rules
./devforgekit graph conflicts       # all conflict edges
./devforgekit graph orphan          # nodes with no connections, grouped by type
./devforgekit graph focus node      # subgraph around a single node
./devforgekit graph history         # past graph snapshots (--compare for diffs)
./devforgekit graph cache --clear   # clear the 30-minute build cache
```

Every subcommand reads through a 30-minute on-disk cache
(`buildGraphCached()`) rather than rebuilding from scratch each time - a
cold build scans the real registry (~15-20s); `--refresh` on any
subcommand bypasses the cache. PNG export is deliberately not supported
(no new dependency, no shelling out to an external tool) - see
[EnvironmentGraph.md](EnvironmentGraph.md) for the full v2.1.4 writeup,
including a real, severe bug the audit found and fixed (a node-ID
mismatch that silently dropped ~22% of edges on the real registry).

## Enhanced Package Installation Status

v1.3.7 replaced generic "install failed" messages with a rich, actionable
status model. Every package installation now reports:

- **17 detailed statuses** (verified, installed, update-available,
  manual-installation, authentication-required, license-required,
  missing-dependency, network-error, timeout, missing-package-manager,
  unsupported-platform, unsupported-architecture, deprecated,
  broken-registry-metadata, broken-download, removed-by-vendor, untested)
- **Responsibility classification** (User / Vendor / DevForgeKit Registry)
  so users know whether to fix it themselves, wait for a vendor, or report
  a registry issue
- **Platform and architecture support** metadata
- **Suggested alternatives** for deprecated or removed packages
- **Rich diagnostics** in both the TUI Components page and the CLI `info`
  command

`devforgekit registry doctor` now includes a quality score, and
`devforgekit registry verify` reports all 17 status counts plus an overall
reliability percentage. `devforgekit registry audit` (v2.1.1) is a
fourth, distinct view: a static (no live installs) curated health
scorecard - package/verified/deprecated/broken-metadata counts, average
quality, and coverage percentages across compatibility/documentation/
validation/aliases/architecture - plus data-driven recommendations for
the highest-leverage gap to close next. The same scorecard is available
as a dashboard page (`y` - Registry).

## Theme System

`./devforgekit theme` (v1.2.x) manages the TUI's professional theming
system — 30 semantic color tokens, 20 built-in themes, custom theme
loading, and WCAG contrast checking:

```bash
./devforgekit theme list              # list all themes (marks current, shows contrast warnings)
./devforgekit theme use nord          # switch to a theme (persists to config)
./devforgekit theme preview dracula   # preview a theme in the dashboard without saving
./devforgekit theme random            # switch to a random theme
./devforgekit theme export -o my.yaml # export a theme to YAML
./devforgekit theme import ./my.yaml  # import a custom theme
./devforgekit theme gallery           # visual gallery in the dashboard
```

Custom themes are YAML files in `~/.config/devforgekit/themes/`. See
[TUI.md](TUI.md#themes) for the full theme format, token list, and
custom theme authoring guide.

## Design

- `./devforgekit <command> [args...]` sets `cmd=$1`, shifts, and either
  `exec`s `bootstrap.sh` directly (for `install`/`bootstrap`), delegates to
  `node cli/bin/devforgekit.js` (every other command, once set up), or
  falls back to the matching `scripts/*.sh` - see the `devforgekit` file
  at the repo root. Adding a new top-level command means adding one file
  under `cli/src/commands/` (see [../cli/README.md](../cli/README.md));
  the root dispatcher itself should never contain new command logic.
- `install`/`bootstrap` are hard-coded to always use `bootstrap.sh`
  directly rather than the Node CLI: a brand-new Mac has no Node yet, and
  bootstrap is what installs it (via `mise.toml`) - see
  [PlatformArchitecture.md](PlatformArchitecture.md) sections 1 and 15.
- `./devforgekit uninstall` is a deliberate stub (prints what to run manually) -
  see [Roadmap](../README.md#roadmap) for planned scope.
