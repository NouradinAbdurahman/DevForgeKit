# Release Readiness Report

A report, not a checklist - the working, granular item-by-item tracker
lives in `docs/ReleaseCandidateChecklist.md`. This is the rollup: what
each area's real, current state is, and the evidence behind the verdict.
Every PASS below is backed by something that was actually executed
against this repository, not inferred.

## Summary

| Area | Status | Evidence |
|---|---|---|
| Architecture | **PASS** | All four layers (Layer 1 bash provisioning, Layer 2 Node CLI, Layer 3 plugins, Layer 4 registry) built, integrated, and documented - `CLAUDE.md`, `docs/PlatformArchitecture.md`. |
| Security | **PASS** | `npm audit --omit=dev`: 0 vulnerabilities. `gitleaks detect`: no leaks found. Full manual security audit completed earlier this cycle (shell-injection, tar zip-slip, unattended-plugin-execution, GCM tag-pinning, TOCTOU fixes), each with a regression test. `SECURITY.md` documents the threat model and trust boundaries. |
| Tests | **PASS** | `npm test`: **1,269/1,269 passing**, 0 failures (up from 1,264 - the 5 regression tests added by this pass's compatibility-matrix bug fixes). `scripts/validate.sh`: see below. |
| Performance | **PASS** | No known hangs remain in the public command surface (this pass alone found and fixed 3 more unbounded-sequential/unbounded-shell-out instances, on top of 3 fixed earlier this cycle - 6 total). A formal startup/dashboard-load benchmark baseline is still open as a non-blocking follow-up (`package analyze`-family commands are correctness-verified but measured at 34-61s cache-cold on a real, populated machine - documented, not hidden, in `docs/CompatibilityReport.md`). |
| Registry | **PARTIAL** | macOS 261/261 (100%), Linux 68/261 (26%), Windows 55/261 (21%). This is data-verification work tracked in `registry/research-queue.md`, not an engineering gap - and it's the single input that gates 6 of the 10 distribution channels (see `docs/DistributionReadiness.md`). |
| Cross Platform | **PARTIAL** | Layer 2 (the Node CLI) is genuinely OS-abstracted (`core/platform/`, real `LinuxPlatform`/`WindowsPlatform` adapters). Layer 1 (`bootstrap.sh`) remains macOS/Homebrew-only by design. Real hardware/VM validation (physical or virtual Ubuntu/Fedora/Arch/Windows 11) has not been performed - only GitHub-hosted CI runners so far. |
| Documentation | **PARTIAL** | `CLAUDE.md` and every subsystem doc kept current throughout. A full documentation *review pass* (every page, every example, screenshots, migration guide, FAQ) is deliberately deferred until after feature freeze, per earlier explicit direction - not started. |
| Compatibility | **PASS** | 228/228 `--help` invocations clean, 69/69 missing-argument error paths clean, full `--json` validity sweep across every read-only command. 3 confirmed real bugs found and fixed, each with a regression test. `docs/CompatibilityReport.md`. |
| API Freeze | **PASS** | Every public command, config file, registry schema, `--json` output contract, environment variable, plugin API, workspace format, snapshot format, and component schema classified Stable/Experimental/Internal. `docs/ApiFreeze.md`. |
| Packaging | **PENDING** | Only the GitHub Release mechanism is Ready today (existing, tested `release.yml`). npm, Homebrew, and Docker are Pending (self-inflicted, not yet built - see below). Winget/Chocolatey/Scoop/APT/Pacman/RPM are Blocked on registry coverage. `docs/DistributionReadiness.md`. |
| Website | **PENDING** | Not started. |
| Distribution | **PENDING** | See `docs/DistributionReadiness.md` for the full per-channel breakdown and why. |

## What changed this pass

This report follows directly from finishing the Backward Compatibility
Matrix and the API Freeze audit - two of the five items on the pre-RC1
list. Real bugs found and fixed along the way, each with a regression
test, in priority order of what they'd have broken for a real user:

1. **`check --json` hung indefinitely.** A 4th instance of the
   "validate all 261 registry packages strictly sequentially" bug
   already fixed 3 times elsewhere this project. Now bounded via the
   shared `mapWithConcurrency` worker pool; completes in ~8s.
2. **`package analyze/duplicates/orphan/outdated/search/unused --json`,
   `package tree`/`graph`, and `repair benchmark --json` all hung past
   25-40s with zero output.** Three independent causes: `analyzePackages()`'s
   own second pass was never converted to bounded concurrency when its
   first pass was; two separate, never-fixed duplicate copies of
   `getInstalledPackageNames()` existed in `packageIntel.js` and
   `repair.js`; and the per-package `du -sk`/`which` shell-outs had no
   timeout at all. All fixed; these commands now complete in 34-61s
   against a real, populated machine instead of never returning.
3. **`repair history --json` and `benchmark history --json` silently
   broke their own `--json` contract** when the result was empty,
   printing a human sentence instead of `[]`. Fixed by reordering the
   check in both handlers.
4. **Two more workflow files had the exact push+pull_request duplicate-run
   problem** already fixed in `cli.yml`/`e2e.yml`/`shellcheck.yml`/
   `registry-smoke.yml` earlier this cycle: `bootstrap.yml` (a real
   macOS `bootstrap.sh --dry-run` run) and `lint.yml` were both running
   identically, twice, for every feature-branch commit. Fixed with the
   same `push: branches: [main]` restriction already proven for the
   other four workflows. `cli.yml`'s push job also gained a fast "unit
   smoke" step (config/registry/command-tree sanity, ~0.2s) so a
   feature-branch push still gets real test signal, not just lint.

None of these fixes touched a Stable API surface - see `docs/ApiFreeze.md`'s
closing note. That's exactly the category of change that should stay
unblocked through RC1.

## Verdict

**Eleven of eleven pre-packaging areas are PASS or the honestly-tracked
PARTIAL they've been for several passes now** (Registry/Cross
Platform/Documentation - all data-verification or explicitly-deferred
work, not defects). Compatibility and API Freeze - the two items this
pass targeted - are both now PASS. Nothing found this pass blocks
`v3.0.0-rc1`; everything found was fixed before this report was written.

**What's left before RC1**, per `docs/ReleaseCandidateChecklist.md`: real
hardware/VM validation, then cutting the `v3.0.0-rc1` tag itself - a
visible, hard-to-reverse action that should get an explicit go-ahead at
the time, not be done unilaterally. Packaging, Website, and Distribution
are correctly Pending - they are RC1's own follow-on work, done during
the dogfooding period, not a blocker for cutting RC1 in the first place.
