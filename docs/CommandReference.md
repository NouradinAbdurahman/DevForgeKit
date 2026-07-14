# Command Reference

Complete reference for every `devforgekit` command. Aliases are shown in
parentheses.

## Core lifecycle

| Command | Description | Flags |
| --- | --- | --- |
| `install` (`bootstrap`) | Full provision: Homebrew, runtimes, dotfiles, editors, services | `--profile <name>`, `--minimal`, `--full`, `--dry-run`, `--skip-services`, `-y/--yes` |
| `uninstall` | Remove installed packages/extensions/config/services (checklist if no flags in a terminal) | `--all`, `--packages`, `--config`, `--vscode`, `--cursor`, `--services`, `--force`/`--yes`/`-y` (required outside a terminal) |
| `update` | Upgrade every managed toolchain, restart services | — |
| `backup` | Capture live config → repo, commit + push if changed | — |
| `restore` | Re-sync dotfiles and editor config from repo | — |
| `self-update` (`upgrade`) | Git pull + npm install + config migration + plugin updates | `--dry-run`, `--skip-plugins`, `--skip-npm` |

## Diagnostics

| Command | Description | Flags |
| --- | --- | --- |
| `check` | Fast PASS/WARNING/FAIL sweep + health score | — |
| `doctor` | Deep diagnostics + PATH manager + health score | `--fix`, `--json`, `--skip-bash`, `--skip-compatibility`, `--export <format>`, `-o/--output <file>`, `--release-check` |
| `validate` | Shell/JSON/YAML/Brewfile/mise/Markdown validation | — |
| `inventory` | Write 9 Markdown reports under `reports/` | — |
| `report` | Write `reports/system-report.txt` | — |
| `services` | Start/stop/restart/status for managed services | `<start\|stop\|restart\|status>` |
| `clean` (`cleanup`) | Reclaim disk space across caches | — |
| `preferences` | Backup/restore macOS UI preferences | `<backup\|restore\|status>` |

## Profiles

| Command | Description | Flags |
| --- | --- | --- |
| `profile list` | List install profiles (Brewfile subsets) | — |
| `profile show <name>` | Show profile contents | — |
| `profile use <name>` | Set persistent default | — |
| `profile install <name>` | Install an environment profile (collections + components + settings) | `-y/--yes` |
| `profile create` | Interactive profile wizard | — |
| `profile export <name> <dir>` | Export installed state as a profile | — |
| `profile import <file>` | Import a profile from file | — |
| `profile search <query>` | Search profiles by name/tag | — |
| `profile publish` | (Stub) Publish a profile | — |

## Recipes

| Command | Description | Flags |
| --- | --- | --- |
| `recipe list` | List all recipes | — |
| `recipe show <name>` | Show recipe details | — |
| `recipe install <name>` | Install + configure + verify in one command | `-y/--yes` |
| `recipe create` | Interactive recipe wizard | — |
| `recipe import <file>` | Import a recipe from file | — |
| `recipe search <query>` | Search recipes by name/tag | — |
| `recipe publish` | (Stub) Publish a recipe | — |

## Components & Registry

See `docs/ComponentManager.md` for `list`/`info`/`doctor`'s unified status aggregation (`core/componentManager.js`) - the same install/version/provider/health/dependency/environment facts every one of these commands reads from, so they can never disagree.

| Command | Description | Flags |
| --- | --- | --- |
| `component list` | Fast grouped browse of all registry components (name + description) | `--category <id>` |
| `component list --status` | Live installed/version/health%/provider/update/conflict per component (slower - shells out per component, see docs/ComponentManager.md's performance note) | `--category <id>`, `--installed`, `--json` |
| `component info <name>` | Unified status: installed/provider/version/binary/health/conflict/environment/dependencies/dependents/capabilities | `--json` (raw manifest instead) |
| `component doctor <name>` | PASS/WARN diagnostic breakdown + health score + repair pointer | `--json` |
| `component install [names...]` | Install components (interactive picker if none given) | `--variant <id>` |
| `component validate <name>` | Run a component's validate command | — |
| `component repair <name>` | Run a component's repair command | — |
| `component update <name>` | Run a component's update command, then refresh its tracked environment facts | — |
| `component reinstall <name>` | Uninstall then install a component fresh | — |
| `component uninstall <name>` (alias `remove`) | Uninstall a component; warns which tracked components depend on it first | — |
| `search <query>` | Search components by name, tag, alias, description | `--category <cat>`, `--tag <tag>` |
| `collection install <name>` | Install a curated collection | `-y/--yes` |
| `collection list` | List all collections | — |
| `info <name>` | Rich component info + Manifest Quality Score | `--live` (verify homepage reachable) |
| `stats` | Installed components, disk, outdated, health | — |
| `registry generate` | Rebuild `registry.json` + `docs/Registry.md` | — |
| `registry stats` | Registry-wide stats + quality score | — |
| `registry verify` | Verify all manifests + integrity | — |
| `registry doctor` | Registry health check + quality score | — |
| `registry audit` | Registry-wide health scorecard + recommendations | — |

## Project Generator

| Command | Description | Flags |
| --- | --- | --- |
| `new --list` | List all 17 supported stacks | — |
| `new --quality` | Show Generator Quality Score per stack | — |
| `new <stack> [name]` | Generate a complete project | `--license <mit\|apache-2.0\|gpl-3.0\|none>`, `--docker`, `--auth`, `--prisma`, `--swagger`, `--state <riverpod\|bloc>`, `--backend <supabase\|firebase>`, stack-specific flags |

Supported stacks: Flutter, Next.js, SvelteKit, Express, React, React
Native, Expo, NestJS, FastAPI, Django, Laravel, Spring Boot, ASP.NET, Go
Fiber, Rust Axum, Tauri, Electron.

## Plugin SDK

| Command | Description | Flags |
| --- | --- | --- |
| `plugin list` | List all discovered plugins | — |
| `plugin info <name>` | Show full plugin manifest | — |
| `plugin run <name> [command]` | Run a plugin's command | — |
| `plugin create <name> [dir]` | Scaffold a plugin from a template | `-t/--template <template>` |
| `plugin test [dir]` | Validate manifest + run test scripts | `--json` |
| `plugin build [dir]` | Validate + regenerate README + write lock file | — |
| `plugin package [dir]` | Create signed `.tar.gz` archive | `--out <dir>`, `--json` |
| `plugin publish <archive>` | Stage archive to a local directory | `--to <dir>` |
| `plugin install <path\|url>` | Install a plugin (verify checksum + signature) | `-y/--yes` |
| `plugin validate [dir]` | Comprehensive structural validation | `--json` |
| `plugin quality [name\|dir]` | 9-category quality score | `--json` |
| `plugin doctor` | Diagnose all plugins for issues | `--json` |
| `plugin trust <pubkey>` | Add a trusted signing key | — |
| `plugin keygen` | (Re-)generate local signing keypair | — |

Templates: `simple-command`, `tui-page`, `generator`, `benchmark`,
`repair`, `graph-extension`, `ai-provider`, `compatibility-rule`.

## Workspace Manager

| Command | Description | Flags |
| --- | --- | --- |
| `workspace create [name]` | Create a new workspace | `--from-current`, `--switch`, `--description <text>`, `--owner <text>` |
| `workspace list` | List all workspaces | `--all` (include archived) |
| `workspace show [name]` | Show workspace details (defaults to active) | — |
| `workspace metadata [name]` | Rich structured metadata | `--json` |
| `workspace switch <name>` | Switch to a workspace (all subsystems) | `--preview` |
| `workspace deactivate` | Clear the active workspace | — |
| `workspace delete <name>` | Delete a workspace | `-f/--force` |
| `workspace rename <old> <new>` | Rename a workspace | — |
| `workspace clone <src> <new>` | Clone a workspace's config | `--description <text>` |
| `workspace search <query>` | Search workspaces | — |
| `workspace verify [name]` | Health-check a workspace | `--structured`, `--json` |
| `workspace repair <name>` | Drop dangling references | — |
| `workspace export <name> [dir]` | Export as `.tar.gz` | — |
| `workspace import <archive>` | Import a workspace bundle | `--name <name>`, `--overwrite` |
| `workspace diff <a> <b>` | Compare two workspaces | `--json` |
| `workspace health [name]` | Quick health score | `--json` |
| `workspace git-capture <name>` | Capture live git identity | — |
| `workspace shell-init [shell]` | Install/remove shell hook | `--uninstall`, `--print` |
| `workspace benchmark <name>` | Benchmark workspace operations | `--runs <n>`, `--ops <list>`, `--json` |
| `workspace snapshot create <name>` | Point-in-time snapshot | `-m/--message <text>` |
| `workspace snapshot list <name>` | List snapshots | — |
| `workspace snapshot restore <name> <id>` | Reset config to snapshot | — |
| `workspace snapshot compare <name> <id> [other]` | Compare snapshots | — |
| `workspace snapshot delete <name> <id>` | Delete a snapshot | — |
| `workspace snapshot export <name> <id> <path>` | Export snapshot to JSON | — |
| `workspace rollback <name> <id>` | Roll back to a snapshot (live) | — |
| `workspace env list [name]` | List env vars (secrets masked) | — |
| `workspace env set <name> <key> <value>` | Set a variable | `--secret` |
| `workspace env unset <name> <key>` | Remove a variable/secret | — |
| `workspace env import <name> <file>` | Import `.env` file | `--secret <keys>` |
| `workspace env export <name> <file>` | Export to `.env` file | `--include-secrets` |
| `workspace ssh list <name>` | List SSH identities | — |
| `workspace ssh add-identity <name>` | Add/update SSH identity | `--host`, `--alias`, `--user`, `--identity-file`, `--port`, `--provider` |
| `workspace ssh remove-identity <name> <alias>` | Remove an SSH identity | — |
| `workspace compatibility scan [name]` | Compatibility scan | — |
| `workspace compatibility repair [name]` | Repair compatibility issues | `--dry-run`, `-y/--yes` |
| `workspace compatibility history [name]` | Scan/repair history | — |

## Compatibility Engine

| Command | Description | Flags |
| --- | --- | --- |
| `compatibility scan` | Scan all installed tools for compatibility | `--json` |
| `compatibility check <name>` | Check a specific component | — |
| `compatibility explain <name>` | Per-component ✓/✗ requirement breakdown | — |
| `compatibility repair` | Plan + execute repairs (confirm before removing) | `--json` |
| `compatibility graph` | Dependency graph of compatibility rules | `--format <dot\|mermaid>` |
| `compatibility update` | Update compatibility rules | — |
| `compatibility export` | Export scan results | `--format <md\|html\|json>` |

## AI Assistant

| Command | Description | Flags |
| --- | --- | --- |
| `ai chat` | Interactive chat REPL | `--stream` |
| `ai doctor [input]` | Diagnose an issue in plain language | — |
| `ai explain <topic>` | Explain a topic/concept/tool in plain language | — |
| `ai review` | Review the current project directory | — |
| `ai generate [prompt]` | Generate a project from a description | `--dir <path>`, `-y/--yes` |
| `ai analyze` | Analyze this environment's health and configuration | — |
| `ai summarize` | Quick plain-language status summary | — |
| `ai optimize` | Suggest concrete optimizations | — |
| `ai repair` | AI-narrated compatibility repair | `-y/--yes` |
| `ai planner <goal>` | Map a goal to real registry entities | `-y/--yes` |
| `ai compare <a> <b>` | Compare two components/stacks | — |
| `ai health` | AI system health score (0-100%) | `--live` |
| `ai status` | Complete AI configuration status report | — |
| `ai fix` | Auto-fix AI configuration issues | — |
| `ai models` | List available models from provider | — |
| `ai benchmark` | Benchmark provider latency/throughput | `--prompt <text>` |
| `ai stats` | AI usage statistics | `--clear` |
| `ai history` | AI event log | `--clear`, `--export <file>` |
| `ai setup` | Guided AI provider setup wizard | — |
| `ai providers` | Show all known providers' config/health | `--check` |
| `ai key add [provider]` | Add an API key for a provider | — |
| `ai key remove <provider>` | Remove a provider's API key | — |
| `ai key list` | List all providers and key status | — |
| `ai key test [provider]` | Test a provider's API key | — |
| `ai key rotate <provider>` | Rotate to a new API key | — |
| `ai key export <file>` | Export keys to a file | — |
| `ai key import <file>` | Import keys from a file | — |
| `ai key migrate` | Migrate env-var keys to secure storage | — |
| `ai provider list` | List all known providers | — |
| `ai provider use <provider>` | Switch the active AI provider | — |
| `ai model list` | List models for the current provider | — |
| `ai model use <model>` | Set the active model | — |
| `ai export [file]` | Export AI config (never API keys) | — |
| `ai import <file>` | Import AI config from a file | — |
| `ai reset` | Reset AI config (keeps keys unless --all) | `--all` |

All `ai` subcommands accept `--provider <id>`, `--model <name>`, and `--endpoint <url>`.

Providers: OpenAI, Anthropic, Gemini, Groq, OpenRouter, Ollama, LM Studio.

## Environment Graph

| Command | Description | Flags |
| --- | --- | --- |
| `graph` (`env`, `deps`) | Build and display the graph (default = `open`) | `--json`, `--save`, `--refresh` |
| `graph open` | Build and display the graph | `--json`, `--save`, `--refresh` |
| `graph cache` | Show or clear the 30-min build cache | `--clear` |
| `graph search [query]` | Search nodes by name/type/tag | `-f/--filter <filter>`, `--json`, `--refresh` |
| `graph explain <name>` | AI-powered node explanation | `--provider <id>`, `--model <name>`, `--refresh` |
| `graph export [format]` | Export graph (json/md/html/dot/mermaid/svg/tree/plantuml) | `-f/--format <fmt>`, `-o/--output <file>`, `--refresh` |
| `graph verify` | Verify graph integrity | `--refresh` |
| `graph stats` | Graph statistics | `--json`, `--refresh` |
| `graph path <from> <to>` | Shortest path between nodes | `--refresh` |
| `graph impact <name>` | Impact analysis for removing a node | `--json`, `--refresh` |
| `graph conflicts` | Show all conflict edges | `--json`, `--refresh` |
| `graph orphan` | Show orphaned nodes | `--json`, `--refresh` |
| `graph focus <name>` | Extract subgraph around a node | `--format <tree\|json\|dot\|mermaid\|svg>`, `--refresh` |
| `graph history` | List graph snapshots | `--compare <newFile>` |

## Environment Configuration Engine

See `docs/EnvironmentEngine.md`. Tracks every tool DevForgeKit installs (observed binary location/version/provider) and generates a single owned shell file (PATH/variables/shell hooks) from installed packages' registry metadata - never hand-edited `.zshrc`/`.bashrc`.

| Command | Description | Flags |
| --- | --- | --- |
| `env doctor` | Validate against real filesystem/shell state: PATH/variables with per-package attribution + repair suggestions, versioned-path replacement detection, live package verification + multi-installation conflicts, sync/hook checks, per-package health breakdown; health score | `--shell <shell>`, `--json` |
| `env validate` | Alias for `env doctor` | `--shell <shell>`, `--json` |
| `env list` | Tracked packages (version/provider/verified/location) + merged PATH (canonical order, with owners)/variables/shell lines | `--json` |
| `env regenerate` | Rebuild every generated shell file and reinstall the shell hook; preserves + reports manual edits, prints shell + running-editor reload guidance | — |
| `env graph [name]` | Dependency tree of tracked tools; with a name, what removing it would affect | `--json` |
| `env shells` | Per-shell writer capability matrix (supported/partial/planned) | `--json` |
| `env diff [snapshotId]` | Packages/versions/PATH/variable deltas since a snapshot (default: most recent) | `--json` |
| `env history [day]` | Transaction log: what each regeneration changed | `--json` |
| `env watch` | Live watch: track newly-installed known tools as their binaries appear | `--interval <seconds>` |
| `env snapshot` | Save a snapshot of the tracked state + generated files (default subcommand: `create`) | `-m/--message <msg>` |
| `env snapshot list` | List saved snapshots, newest first | `--json` |
| `env restore <id>` | Restore a snapshot's state and regenerate from it (safety snapshot taken first) | — |

## Developer Experience

| Command | Description | Flags |
| --- | --- | --- |
| `explain <name>` | Why a component is installed (required-by profiles/collections/dependents), what it depends on, and whether it's safe to remove | `--json` |

## Shell Completions

| Command | Description | Flags |
| --- | --- | --- |
| `completion install` | Install zsh/bash/fish completions - defaults to the current shell (`$SHELL`). Homebrew installs already wire these via the formula; this is for npm installs | `--shell <zsh\|bash\|fish>`, `--all` |
| `completion uninstall` | Remove installed completions - defaults to the current shell | `--shell <zsh\|bash\|fish>`, `--all` |
| `completion status` | Install status per shell (available/installed/up to date) | `--json` |
| `completion doctor` | Diagnose stale installs or a manually edited rc block, with the fix command to run | — |

## Package Intelligence

| Command | Description | Flags |
| --- | --- | --- |
| `package` (`packages`, `pkg`) | Package intelligence commands | — |
| `package analyze` | Scan all installed packages | — |
| `package info <name>` | Complete profile for one package | — |
| `package tree [name]` | Dependency tree | — |
| `package graph [name]` | Dependency graph | `--format <text\|dot\|mermaid>` |
| `package orphan` | Packages with no reverse deps | — |
| `package duplicates` | Duplicate runtime detection | — |
| `package unused` | Alias for orphan (usage-focused) | — |
| `package outdated` | Packages with newer versions | — |
| `package recommend` | AI-powered recommendations | — |
| `package impact <name>` | Removal impact analysis | — |
| `package search [query]` | Search packages | `--filter <filter>` |
| `package compare <old> <new>` | Compare two analysis files | — |
| `package history` | Past analysis records | — |
| `package export [format]` | Export to json/md/html/csv/dot/mermaid | — |

## Benchmark Engine

| Command | Description | Flags |
| --- | --- | --- |
| `benchmark` (`bench`, `perf`) | Quick benchmark (default) | `--no-save`, `--json` |
| `benchmark quick` | Quick benchmark (~10-20s) | `--no-save`, `--json` |
| `benchmark standard` | Standard benchmark (~30-60s) | `--no-save`, `--json` |
| `benchmark full` | Full benchmark (~2-5min) | `--no-save`, `--json` |
| `benchmark compare [old] [new]` | Compare two results | `--json` |
| `benchmark history` | List past results | `--filter-profile <p>`, `--filter-grade <g>` |
| `benchmark export <id>` | Export a result | `-f/--format <json\|md\|html\|csv>`, `-o/--output <file>` |
| `benchmark delete <id>` | Delete a result | — |
| `benchmark explain [id]` | AI-powered analysis | `--provider <id>`, `--model <name>` |
| `benchmark trend [category]` | Trend analysis across history | `-n/--limit <n>`, `--json` |
| `benchmark intelligence [id]` | Self-explaining report (no AI) | `--category <cat>` |
| `benchmark report [id]` | Rich report with comparison | — |

## Repair Engine

| Command | Description | Flags |
| --- | --- | --- |
| `repair` (`fix`, `heal`) | Full pipeline: scan → plan → repair → verify | `-y/--yes`, `--dry-run` |
| `repair scan` | Run 13 scanners | `--json`, `--category <cat>` |
| `repair plan` | Generate ordered repair plan | `--dry-run`, `--json` |
| `repair explain` | AI-powered root cause analysis | `--provider <id>`, `--model <name>` |
| `repair explain-issues` | Explain issues in human-readable format | `--plan`, `--json` |
| `repair verify` | Post-repair verification | `--benchmark` |
| `repair rollback <snapshotId>` | Restore pre-repair snapshot | — |
| `repair rollback-repair <repairId>` | Roll back a specific repair | `--snapshot`, `-y/--yes` |
| `repair rollback-list` | List rollback points | — |
| `repair history` | List repair records | `--clear`, `--search <query>` |
| `repair export <id>` | Export a repair record | `-f/--format <json\|md\|html\|csv>`, `-o/--output <file>` |
| `repair delete <id>` | Delete a repair record | — |
| `repair clean` | Delete all repair history | — |
| `repair benchmark` | Benchmark repair engine performance | `-n/--iterations <n>`, `--json` |

## Snapshot & Restore

| Command | Description | Flags |
| --- | --- | --- |
| `snapshot create` | Capture environment into `.dfk` archive | `--compression <fast\|normal\|max>`, `--output <dir>`, `--skip-inventory` |
| `snapshot restore <archive>` | Restore from archive | `--skip-packages`, `--skip-workspaces`, `--skip-config`, `--skip-compatibility`, `--force` |
| `snapshot list` | List all snapshots | — |
| `snapshot inspect <archive>` | Detailed metadata | — |
| `snapshot verify <archive>` | Validate integrity | — |
| `snapshot diff <old> <new>` | Compare two snapshots | — |
| `snapshot export <id> <dir>` | Copy a snapshot | — |
| `snapshot delete <id>` | Delete a snapshot | — |
| `snapshot explain <archive>` | AI-powered snapshot explanation | `--provider <id>`, `--model <name>` |

## Configuration

| Command | Description | Flags |
| --- | --- | --- |
| `config` | Show current configuration | — |
| `config list` | Print fully merged, effective configuration | `--json` |
| `config set <key> <value>` | Set a config value | — |
| `config get <key>` | Get a config value | — |

Config file: `~/.config/devforgekit/config.yaml`

Fields: `editor`, `shell`, `packageManager`, `fonts`, `browser`,
`aiProvider`, `defaultProfile`, `updateSchedule`, `telemetry`,
`mirrors`, `registryUrl`, `colorOutput`, `tuiTheme`,
`startupAnimation`, `startupAnimationSpeed`, `reducedMotion`,
`onboardingSeen`.

## Themes

| Command | Description | Flags |
| --- | --- | --- |
| `theme list` | List all available themes (marks current) | — |
| `theme use <id>` | Switch to a theme (persists to config) | — |
| `theme preview <id>` | Preview a theme in the dashboard without saving | — |
| `theme random` | Switch to a random theme | — |
| `theme export [id]` | Export a theme to YAML (defaults to current) | `-o/--output <file>` |
| `theme import <file>` | Import a custom theme from a YAML file | — |
| `theme gallery` | Show a scrollable theme gallery in the dashboard | — |

## Release

| Command | Description | Flags |
| --- | --- | --- |
| `release <patch\|minor\|major\|rc\|promote>` | Bump version (or cut/promote a release candidate), draft changelog, tag, push | `-y/--yes` |
| `rc-validate` | Distribution Verification & RC Validation - GitHub Release/npm/Homebrew/install lifecycle/smoke tests/regression suite, writes `docs/RCValidationReport.md` | `--skip-npm`, `--skip-homebrew`, `--skip-github-release`, `--skip-scaffold` |

## TUI Dashboard

| Command | Description | Flags |
| --- | --- | --- |
| `devforgekit` (no args) | Open interactive dashboard | — |
| `dashboard` (`ui`) | Open dashboard explicitly | `--page <id>` |

See [KeyboardShortcuts.md](KeyboardShortcuts.md) for the full TUI
keyboard reference.
