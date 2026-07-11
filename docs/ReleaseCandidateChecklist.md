# Release Candidate Checklist

An actual checklist, not documentation — the gate for tagging
`v3.0.0-rc1`. Nothing here is aspirational; every ✓ below reflects a
real, verified state as of this writing (see the evidence column).
Update this file, don't just re-derive its contents from memory, as
each remaining item closes.

## Release Readiness

| Area | Status | Evidence |
|---|---|---|
| Architecture | ✓ | Installation Engine, Environment Engine, Component Manager, Registry Engine, TUI, AI Assistant, Repair Engine, Snapshot Engine, Plugin System, Workspace Manager, Compatibility Engine, OS Abstraction Layer — all built, all with dedicated `docs/*.md`. |
| Security | ✓ | Full audit this session: real shell-injection, tar zip-slip, unattended-plugin-execution, GCM tag-pinning, and TOCTOU fixes, each with a regression test. `npm audit`: 0 vulnerabilities. `gitleaks`: 0 secrets. See `SECURITY.md`. |
| Command Safety | ✓ | Full audit of all 38 command files / ~200 subcommands. Two confirmed violations (`registry verify`, `workspace benchmark`) fixed, each with a canary-file regression test. See `docs/CommandSafety.md`. |
| Tests | ✓ | 1,264/1,264 passing (`npm test`). 749/749 `scripts/validate.sh` checks (ShellCheck, `bash -n`, JSON/YAML/Markdown, lint, tests). |
| Registry | Partial | 261/261 packages have verified macOS coverage. 68/261 Linux, 55/261 Windows (registry/completeness-baseline.json, CI-gated against regression). Remaining 193/206 packages tracked in `registry/research-queue.md` — this is data verification, not engineering, and is the single largest remaining item before "cross-platform" can be called complete. |
| CI | ✓ | `cli.yml` (lint + full test suite), `e2e.yml` (real install→validate→doctor→env→repair→workspace→uninstall lifecycle on macOS/Ubuntu/Windows runners), `shellcheck.yml`, `codeql.yml`, `dependency-review.yml`, `scorecard.yml`, `registry-smoke.yml`, `bootstrap.yml` all green on the current branch. Push/PR duplicate-run waste fixed (push now runs a fast subset; full suite runs once, on PR). |
| Cross Platform | Partial | Layer 2 (Node CLI) is genuinely cross-platform: OS Abstraction Layer, `LinuxPlatform`/`WindowsPlatform` adapters, platform-aware installer/compatibility/repair. Layer 1 (`bootstrap.sh`) remains macOS/Homebrew-only **by design** (documented, not a gap). Real-machine validation (physical/VM Ubuntu, Fedora, Arch, Windows 11) not yet performed — only GitHub-hosted CI runners so far. |
| Performance | Partial | Three real, verified fixes this session (doctor ~52s→~17.5s, package analyze/search, benchmark's compatibility check) via a shared bounded-concurrency worker pool. No formal baseline captured yet for startup/dashboard/registry-load/env-generation/component-list — this is the "measure, don't guess" work still pending. |
| Documentation | Partial | `CLAUDE.md` is comprehensive and kept current throughout this session. Full doc *review* (every page, every example, screenshots, migration guide, FAQ, troubleshooting) deliberately deferred until after feature freeze, per explicit earlier direction — not started. |
| Backward Compatibility Matrix | ✓ | 228/228 `--help` invocations clean, 69/69 missing-argument error paths clean, full `--json` validity sweep across every read-only command. Found and fixed 3 real bugs along the way (a 4th/5th/6th instance of the unbounded-sequential-validate class, plus a `--json`-ignored-on-empty-result bug in two commands), each with a regression test. See `docs/CompatibilityReport.md`. |
| API Freeze | ✓ | Every public command, config file, registry schema, JSON output, env var, plugin API, workspace format, snapshot format, and component schema classified Stable/Experimental/Internal. `ai *` and per-command JSON payload shape deliberately left Experimental. See `docs/ApiFreeze.md`. |
| Real hardware/VM validation | Not started | macOS Intel, Apple Silicon, Ubuntu, Fedora, Arch, Windows 11, fresh VMs — outside this sandbox's reach; needs the user's own hardware or a VM farm. |
| v3.0.0-rc1 tag | Not started | Blocked on the four items above. `v3.0.0` (final) is already tagged from an earlier, less-complete snapshot 20 commits behind current work — the next tag must be `v3.0.0-rc1`, not a reused `3.0.0`. |
| Website | Pending | Not started. |
| Homebrew Formula | Pending | Not started. |
| npm Package | Pending | Not started (the CLI already has a `cli/package.json` — publishing to the npm registry as an installable package is separate work). |
| Winget | Pending | Not started. |
| Chocolatey | Pending | Not started. |
| Scoop | Pending | Not started. |
| APT | Pending | Not started. |
| Docker | Pending | Not started. |
| GitHub Release | Pending | Depends on the RC1 tag above. |

## The rule

**Until every item above is green, don't release.** RC1 itself only
needs the first eleven rows (through "API Freeze") — the packaging rows
are Release Candidate 1's own follow-on work, done in parallel with
dogfooding, not a blocker for cutting RC1 in the first place.

## What's explicitly NOT in scope right now

No new features. Not AI, not TUI pages, not commands, not a registry/
plugin/environment redesign. The architecture is finished; what
remains is validation, completeness, and release engineering.
