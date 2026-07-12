# v3.0.1-rc1 Release Certification

The canonical release record for the v3.0.1 release cycle: every distribution
channel, every verification step actually performed, every known limitation,
and the reasoning behind every non-obvious release decision. Written once the
release-candidate work was complete, not maintained retroactively - later
corrections belong in the "Corrections" convention already established by
`docs/releases/3.0.1-rc1-publish.md`, appended below rather than rewriting
history.

**Status: Release Candidate.** Not yet promoted to stable. See
[RC period](#rc-period) below for what happens next.

## Distribution channels

| Channel | Status | Reference |
|---|---|---|
| GitHub Release | Draft, not published | [`v3.0.1-rc1`](https://github.com/NouradinAbdurahman/DevForgeKit/releases/tag/untagged-a803720c497fee4d3f99) (draft URL - becomes `.../releases/tag/v3.0.1-rc1` once published) |
| npm | **Published**, `next` tag | [`devforgekit@3.0.1-rc1`](https://www.npmjs.com/package/devforgekit) - `npm install -g devforgekit@next` |
| Homebrew | **Published** | [`NouradinAbdurahman/homebrew-devforgekit`](https://github.com/NouradinAbdurahman/homebrew-devforgekit) - `brew tap NouradinAbdurahman/devforgekit && brew install devforgekit` |
| Source | Always available | `git clone` + `./devforgekit install` |

Both npm and Homebrew currently install the *same* `v3.0.1-rc1` build - there
is no separate "stable" track to fall back to yet, since this is the first
release cycle to go through either channel for real. See
[Release decisions](#release-decisions) for why that's intentional rather
than an oversight.

## Verification performed

Everything below was run for real against the actual published artifacts -
never assumed from reading code, and never claimed without the command that
produced it.

### Automated

- Full test suite: **1,350/1,350 passing** (`npm test --prefix cli`).
- `shellcheck -x` clean across every modified/new shell script.
- `./scripts/validate.sh` clean (shell syntax, ShellCheck, Brewfile, mise.toml, JSON, YAML, Markdown).
- `devforgekit doctor --release-check` passes against the real downloaded release tarball (version consistency, required docs, distribution artifacts, registry health, git tree, CI status).
- CI green on every required check across PRs #22-#31 (`lint`, `test`, `dry-run`, CodeQL `analyze` (JS/TS + Python), `shellcheck`, `pack-and-verify` (macOS + Ubuntu), `formula-test`).

### npm channel

- `npm publish --dry-run --tag next` verified before the real publish.
- Real publish completed (required interactive 2FA/OTP - done by the package owner directly, not automatable).
- `npm view devforgekit` / `version` / `versions` / `dist-tags` confirmed post-publish: integrity hash, version, and tags all correct.
- Fresh install into a scratch prefix (`npm install -g devforgekit@next`) from the real, live registry - not a local tarball.
- `devforgekit --version`, `doctor`, `check`, `completion install`, `completion doctor` all verified against the real installed package.
- `npm uninstall -g devforgekit` - fully clean, 0 files remaining.
- Reinstall after uninstall - works identically.
- Consumer audit (separate from the above, run before publishing): `npm pack` contents match expectations, install from the packed `.tgz` (not the repo) from an unrelated directory, PATH integration via npm's own `bin` mechanism, no hardcoded reference to the source repo's location anywhere in the installed package.

### Homebrew channel

- Real sha256 computed against the actual GitHub-generated `v3.0.1-rc1` tarball (`shasum -a 256`, never hand-typed, matching the formula's own documented update flow).
- Formula tested locally against a scratch tap before the public tap existed.
- Public tap repository created: `NouradinAbdurahman/homebrew-devforgekit`.
- Full lifecycle tested against the real, live public tap:
  - `brew tap NouradinAbdurahman/devforgekit` - succeeds.
  - `brew audit --formula` - clean, no findings.
  - `brew style` - "1 file inspected, no offenses detected".
  - `brew install` - builds cleanly (6,541 files, 22MB, ~4s), `devforgekit --version`/`doctor` correct afterward, all three shells' completions installed to their real Homebrew-managed locations (`zsh`: `site-functions/_devforgekit`; `bash`: `etc/bash_completion.d/devforgekit.bash`; `fish`: `vendor_completions.d/devforgekit.fish`).
  - `brew upgrade` - correctly reports already up to date (only one formula revision exists yet).
  - `brew reinstall` - clean, no errors, version unchanged.
  - `brew uninstall` - fully clean removal, command no longer resolves.
  - `brew doctor` - see [Known RC Limitations](#known-rc-limitations) (tap-trust warning, expected).
  - `brew livecheck` - see [Known RC Limitations](#known-rc-limitations) (reports "behind" due to the still-draft GitHub Release, expected).

### New-developer-experience audit

Performed from scratch, treating the project as genuinely unfamiliar:
starting from the GitHub repository page, reading only the public README and
`docs/CommandReference.md`, installing via npm, running the install wizard
(`--dry-run`, since a real run performs genuine system-wide Homebrew
installs with no scratch-prefix equivalent - see the note in
[Known RC Limitations](#known-rc-limitations)), and generating a real first
project end-to-end.

**Found and fixed** (this is the one category of finding that was a genuine
DevForgeKit-side gap, not a third-party tool quirk):

- The README's Installation section only ever showed `git clone` +
  `bootstrap.sh` - no mention of npm or Homebrew anywhere, despite npm being
  the whole point of a fast, lightweight install. A first-time visitor would
  never discover `npm install -g devforgekit@next` (timed for real: ~6
  seconds end-to-end). Fixed in #31: npm promoted to the primary
  documented install method, Homebrew second, source build reframed as the
  advanced/contributing option. Stale version badge (`3.0.0`) and
  test-count badges (`1,299`) corrected across five locations. Quick
  Start and Troubleshooting/FAQ command examples switched from
  `./devforgekit` (only correct for a source checkout) to the global
  `devforgekit` a package install actually gives you. Commands table
  gained the `completion` row.

**Verified working well, no changes needed:**

- `--help` output: comprehensive, well-organized, real copy-pasteable examples.
- Error handling: `error: unknown command 'frobnicate'` is clear; a missing required argument (`devforgekit new`) falls into a friendly interactive picker instead of a bare error.
- No broken internal documentation links (checked every `docs/*.md` reference in the README).
- All four referenced screenshot images and the banner image exist on disk; README fetched directly from GitHub post-fix shows no broken markdown, tables, or images.
- Real project generation (`devforgekit new express my-first-api --license mit --auth --prisma --swagger --docker`): produces a complete, well-structured project (git initialized, README, LICENSE, Dockerfile, CI workflow, tests/), generated code passes `node --check`, `npm install` succeeds, the printed "Next commands" list is accurate.
- The install wizard's step-numbered (`Step N/8`) dry-run flow is clear and produces an accurate health-score summary.

## RELEASE.md checklist verification

Every item in `RELEASE.md`'s "at a glance" checklist, verified individually
- nothing left as "unknown."

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `scripts/validate.sh` passes | **PASS** | Clean (ShellCheck, `bash -n`, Brewfile, mise.toml, JSON, YAML, Markdown) - both standalone and as part of the full `rc-validate.sh` run. |
| 2 | `npm test --prefix cli` passes | **PASS** | 1,350/1,350, confirmed multiple times this cycle, most recently inside the full `rc-validate.sh` run. |
| 3 | No failed GitHub Actions runs on the commit being released | **PASS** | `gh run list --commit <HEAD>`: 5 runs checked (Core CLI, Bootstrap, Lint, Scorecard, CodeQL), all `success`. |
| 4 | `docs/CompatibilityReport.md`, `docs/ApiFreeze.md`, `docs/ReleaseReadinessReport.md` reflect current state | **PASS with a note** | Underlying content (command behavior contracts, API stability classifications) is substantively unchanged this cycle - no command's stability classification or exit-code/`--json` contract changed. Headers still reference "before v3.0.0-rc1" as a historical marker of when each audit ran; left as-is (accurate for its own time, same reasoning as not rewriting `docs/RC1_Final_Report.md`). `docs/ReleaseReadinessReport.md`'s stale cross-reference to the now-superseded `docs/ReleaseCandidateChecklist.md` was fixed to point at this document. |
| 5 | Working tree is clean and on `main` | **PASS** | True as of the commit this document itself was merged in. |
| 6 | `devforgekit doctor --release-check` passes | **PASS** | All checks pass (version consistency, required docs, distribution artifacts, registry, no pending-work markers, no debug flags, CI status) once the working tree is clean - confirmed via a full run; the only failure observed during active editing was the working-tree check itself, which resolves on commit. |
| 7 | `devforgekit rc-validate` passes | **PASS with 2 documented, non-blocking warnings** | Full run: 36 passed, 2 warnings, 2 failed. Both failures and both warnings trace to the same two already-understood, non-blocking causes: (a) this development machine's own pre-existing, non-Homebrew `devforgekit` on PATH collided with the script's local test-tap install, skipping `brew link` and causing the subsequent `--version` check to read the wrong binary - the Formula itself built correctly into the Cellar, `doctor` against it passed, and the real `homebrew-formula.yml` CI workflow (a genuinely clean runner, no pre-existing install) has passed on `main` and every recent PR; (b) the working-tree/release-check failure from item 6, same cause, same resolution. Full detail in `docs/RCValidationReport.md`. |

## Known RC Limitations

Real, genuine, observed limitations - not speculative, and not DevForgeKit
defects where the cause is a third-party tool's own behavior. Documented
here so none of it gets mistaken for a bug during the RC period.

- **The Homebrew tap is unsigned and therefore untrusted until users
  explicitly tap it.** `brew doctor` reports
  `nouradinabdurahman/devforgekit` as "not trusted" immediately after
  tapping - expected for any new, unofficial Homebrew tap (Homebrew's
  tap-trust feature), unrelated to this tap's actual content. Confirmed
  live: real installs/builds/links/uninstalls all worked correctly despite
  the warning.
- **The still-draft GitHub Release causes `brew livecheck` to report
  `v3.0.0` as the latest available version**, i.e. that the formula
  (`3.0.1-rc1`) is "ahead of" latest. `v3.0.1-rc1`'s GitHub Release is a
  **draft** (not published), so GitHub's own "latest release" marker still
  points at the real, published `v3.0.0`. `livecheck` is behaving exactly
  as designed; the RC's use of an unpublished draft is what creates the
  mismatch. Resolves once a release is published.
- **npm's first-publication behavior temporarily assigns both `latest` and
  `next` to the RC.** npm always assigns `latest` to a package's very
  first publish regardless of `--tag` - there was no prior stable version
  for it to keep pointing at. Deliberately left as-is (see
  [Release decisions](#release-decisions)) rather than removed, since
  removing it would leave a tagless `npm install -g devforgekit` with no
  default version to resolve at all. Resolves automatically the moment a
  real `v3.0.1` stable is published. Full detail:
  `docs/releases/3.0.1-rc1-publish.md`.
- **Full hardware validation across Intel macOS, Windows, Fedora, and Arch
  remains outstanding.** Every verification in this document ran on a
  single machine: macOS, Apple Silicon. npm's package is restricted to
  darwin/linux (Windows users need WSL or the source install); the
  Homebrew formula has not been built or installed on Intel macOS or any
  Linux distribution. This is the one genuinely open item before stable -
  see [RC period](#rc-period).
- **`npm install`/`npm publish` print `allow-scripts` warnings** (npm
  11.x's allow-scripts gate skipping a package's `postinstall` by
  default) - inherent npm 11.x behavior affecting any package with a
  postinstall script, not specific to DevForgeKit. DevForgeKit's own
  dispatcher self-heals this transparently on first run.
- **The install wizard's real (non-`--dry-run`) run was not exercised
  end-to-end during this audit.** Homebrew has no scratch-prefix
  equivalent to npm's - a real run genuinely installs formulae
  system-wide, so testing it live against the maintainer's own
  development machine was deliberately avoided. `--dry-run` was exercised
  fully instead (accurately reports what would happen, matches documented
  behavior). A real end-to-end run belongs on the same clean/disposable
  machines the hardware-validation item above already calls for.

## Release decisions

Brief rationale for the non-obvious calls made this cycle, each with a
pointer to where the full reasoning lives.

- **`v3.0.0-rc1` was abandoned in favor of `v3.0.1-rc1`.** The original tag
  numbering was a real bug (`release.sh rc` appended `-rc1` to an
  already-shipped, already-tagged `3.0.0` without bumping forward first,
  producing a version lower than the real release it was meant to be a
  candidate for). Full writeup: `docs/ReleaseArchitecture.md`, PR #26.
- **The release process is two-phase (`create` then `finalize`)**, tagging
  only happens after a release PR merges to `main`, never before - required
  by this repo's branch-protection ruleset (`bypass_actors: []`, no one can
  push directly to `main`, including admins). Full writeup:
  `docs/ReleaseArchitecture.md`.
- **npm's `latest` dist-tag was deliberately left pointing at the RC**
  rather than removed. Removing it would leave a tagless
  `npm install -g devforgekit` with no default version to resolve at all
  (`ERR! No matching version found`) - worse than a short-lived
  RC-as-latest for a package's first-ever publish. Full writeup:
  `docs/releases/3.0.1-rc1-publish.md`.
- **The Homebrew tap points at `v3.0.1-rc1`, not the older real `v3.0.0`.**
  Homebrew has no equivalent of npm's `next`/`latest` dual-tag system -
  whatever the formula's `url` points at is what every `brew install` gets.
  Since the entire point of the RC period is testing this exact build
  across every channel, pointing Homebrew at the stale `v3.0.0` would have
  made Homebrew testers validate different code than npm testers. The
  formula will be bumped again when `v3.0.1` stable ships - "no reason to
  maintain two different RC builds."
- **Two pre-existing TUI test timing budgets were widened (2000ms →
  5000ms)**, found while chasing what looked like flaky CI on PR #28: both
  failed 3 times in a row under real concurrent full-suite load, each only
  marginally over budget (not a real hang), and the suite has grown from
  1,088 to 1,350 tests since those budgets were set. `tui-resize.test.js`'s
  separate copy of the same helper was left untouched - not implicated in
  any observed failure, and a speculative change without evidence isn't a
  real fix.

## RC period

Per the maintainer's own stated policy from this point forward: **no new
features**. Only:

- installation bugs
- crashes
- security issues
- packaging issues
- documentation fixes

Everything else is deferred to v3.1.

**Promotion to stable (`v3.0.1`)**, once RC feedback is clean:

1. Merge any accepted fixes.
2. `npm dist-tag add devforgekit@3.0.1 latest` (or a plain `npm publish` for the real `3.0.1`, which moves `latest` forward on its own).
3. Update the Homebrew formula's `url`/`sha256` to the real `v3.0.1` tag.
4. Publish the GitHub Release (`gh release edit v3.0.1 --draft=false`, or the equivalent for whatever tag `3.0.1` actually lands on).
5. Update the website and announce.

## Corrections

<!-- Append dated notes below this line as issues are found during the RC period. Never rewrite the sections above. -->

**2026-07-12** - Restored the maintainer's development machine's global
`devforgekit` command, left pointing at a removed Homebrew Cellar path
after the Homebrew lifecycle test's `brew uninstall` step. Restored via the project's
own supported mechanism - `devforgekit repair install --yes` (backed by
`scripts/repair_install.sh symlink` → `install_global_command` in
`scripts/common.sh`), not a manual `ln -sf`. Verified afterward:
`devforgekit --version` → `3.0.1-rc1`; `which devforgekit` →
`/opt/homebrew/bin/devforgekit`; `readlink` → the source checkout's own
`devforgekit` dispatcher (the original, correct target); `doctor` runs
cleanly; `completion status` correctly reports no completions installed
on this machine's real shell config (all completion testing this cycle
ran against isolated scratch `$HOME`s, never this machine's real
`.zshrc`/`.bashrc`).

**2026-07-12** - First `v3.0.1` tag attempt rolled back. `scripts/
release.sh finalize` tagged the real merge commit and pushed `v3.0.1`,
but the release workflow correctly failed at the "Release readiness
gate": `Formula/devforgekit.rb` still referenced `3.0.0`, and
`checkVersionConsistency()`'s pre-release exemption (see "Release
decisions" above) no longer applies once `VERSION` is a clean version
with no `-rcN` suffix - exact match is required. This is a real
release-process **ordering** bug, not a validation bug: the gate
correctly requires the Formula to already be updated before it will
create the release, but the Formula's `url`/`sha256` can only
correctly reference a tag once that tag exists - a circular dependency
in the current pipeline (worth a v3.1 redesign, not fixed here - see
`docs/Release_3.0.1_Final.md` once written).

Followed `RELEASE.md`'s own documented rollback procedure for exactly
this situation ("After pushing a tag but before publishing the draft,
still nothing public has happened"): verified first, then rolled back.
- `gh release view v3.0.1` → "release not found" - no GitHub Release was ever created.
- `npm view devforgekit versions` → still only `3.0.1-rc1` - no npm publish occurred.
- `Formula/devforgekit.rb` still referenced `v3.0.0` - never touched `v3.0.1`.
- `git push origin :refs/tags/v3.0.1` + `git tag -d v3.0.1` - tag removed, confirmed gone via `git ls-remote --tags origin`.
- The local release-state file (`.devforgekit-release-state.json`) was left intact - PR #38 is genuinely merged, so a re-run of `finalize` after the Formula fix lands will correctly re-tag the same commit.

**2026-07-13** - Formula fix-forward: re-pushed the `v3.0.1` tag (`git tag
-a v3.0.1 <commit 2618c9b>` + `git push origin v3.0.1`, not the full
`release.sh finalize` script) for the sole purpose of making the real,
GitHub-generated archive fetchable - the Formula's own header comment
requires `shasum -a 256` against the actual
`archive/refs/tags/vX.Y.Z.tar.gz`, never a hand-typed or assumed value,
and no tag means no such archive exists to hash. A commit-SHA-based
archive URL (`archive/<sha>.tar.gz`) was deliberately not substituted:
GitHub embeds the ref name into every path inside the generated tarball,
so a commit-SHA archive is not byte-identical to the tag-named archive
the Formula actually references - using it would risk shipping a
checksum that doesn't match what `brew install` really downloads.
Pushing the tag alone (no `finalize` run) re-triggers `release.yml`,
which is expected to fail again at the same known gate since the Formula
still isn't fixed yet - harmless, since the workflow's failure creates no
GitHub Release, no draft, and no published artifact, matching the same
rollback-safe window documented above. Fetched
`https://github.com/NouradinAbdurahman/DevForgeKit/archive/refs/tags/v3.0.1.tar.gz`
directly and computed: `sha256:
08420ee92ab13f6974720e09692ef9c514108c1a043fc8fed48265a3ae60f38b`
(7,222,463 bytes). This is the real, verified checksum used in the
Formula update below - not guessed, not fabricated.

**2026-07-13** - Second Formula correction: the self-reference problem
predicted above turned out to be real, not just theoretical. PR #39's
sha256 was computed against the `v3.0.1` tag as it existed *before* the
Formula fix landed (pointing at commit `2618c9b`). `scripts/release.sh
finalize` then correctly deleted and re-pushed `v3.0.1` to point at the
new merge commit (`1a6767f`) that contains PR #39's own Formula change -
a genuinely different commit, so a genuinely different archive
(7,223,473 bytes, not 7,222,463) and a genuinely different sha256.
Caught by re-downloading the real, now-published `v3.0.1` tag's archive
and comparing checksums directly rather than assuming the earlier value
still held: real sha256 is `58e8c3f82edf9301a4697157292c7290aeb0368728fbe048da81957f8f1d19ac`.
This is expected to be a one-time cost, not a recurring one: `v3.0.1`'s
tag is now a real, published GitHub Release and won't be re-pointed
again (per `RELEASE.md`'s rollback guidance, moving a tag that's been
live "for more than a few minutes" needs explicit confirmation and isn't
being done here) - this Formula fix lands in a *later* commit on `main`
that has no effect on what the already-tagged, already-published
`v3.0.1` archive contains. The circular dependency this surfaces (the
Formula file lives inside the same repo/tag it describes) is the same
one already flagged for a v3.1 pipeline redesign, not re-litigated here.

**2026-07-13** - Phase 4 (GitHub Release verification) found a real,
separate bug: the published `v3.0.1` release's body was empty.
`release.yml`'s changelog-extraction step (`awk` between the `## [3.0.1]`
heading and the next `## [` heading) worked correctly - the actual
problem was upstream, in `CHANGELOG.md` itself: `scripts/release.sh
promote` renamed the (empty) `## [Unreleased]` heading straight to
`## [3.0.1]` with no content added, since promoting an RC to stable is
genuinely a no-code-change operation - but that left the section
completely blank, which produced a technically-non-empty-but-effectively-blank
release body (one bare newline, passing the workflow's own `[[ -s
release-notes.md ]]` non-empty check without tripping its "no section
found" warning). Verified real: `shasum -a 256 -c SHA256SUMS.txt`
against the actual downloaded assets (`gh release download v3.0.1`) - 7/7
OK; both SBOMs reference `3.0.1` (`sbom-cyclonedx.json`'s
`metadata.component.version`, `sbom-spdx.json`'s
`packages[0].versionInfo`); the source archive's sha256 matches the one
now in the Formula. Fixed forward, not by re-tagging (`RELEASE.md`'s own
rollback guidance: "After publishing the draft... treat it as public...
prefer forward fixes") - added real content to `CHANGELOG.md`'s
`## [3.0.1]` section explaining the promotion and pointing at
`## [3.0.1-rc1]`'s existing content for the substance, then updated the
already-published release's body directly (`gh release edit v3.0.1
--notes-file`, which edits the live release without touching the
immutable tag or its own tagged snapshot of `CHANGELOG.md`).

**2026-07-13** - Phase 5 (npm verification) found a real bug in
`package.json`: `bin.devforgekit` was `"./devforgekit"` (leading `./`),
which this npm client (11.16.0) flags at publish time -
`npm warn publish "bin[devforgekit]" script name devforgekit was invalid
and removed` - and auto-corrects rather than rejecting outright. Checked
whether this had already shipped a broken package: `npm view
devforgekit@3.0.1-rc1 bin` shows the registry's live copy already has
the corrected bare form (`"devforgekit": "devforgekit"`), confirming
npm's auto-correction applied silently and successfully during that
earlier publish - the already-public `3.0.1-rc1` package is not broken.
Still fixed forward in `package.json` on `main` (`npm pkg fix`'s own
suggested correction) rather than left to keep relying on silent
per-publish auto-correction, which is exactly the kind of behavior a
future npm version could tighten into a hard failure instead. The
actual attempted `npm publish` for `3.0.1` failed separately, before
this bug could matter either way: `npm whoami` returned `401
Unauthorized` - an expired local npm login session, not a package or
registry defect. Re-authentication needed before retrying the real
publish.

**2026-07-13** - Phase 5 completed. After PR #42 merged, the repository
owner re-authenticated (`npm login`, then a real `npm publish`
completing npm's browser-based publish approval flow) and published
`devforgekit@3.0.1` for real. Verified: `npm view devforgekit version`
-> `3.0.1`; `npm view devforgekit versions` -> `["3.0.1-rc1", "3.0.1"]`;
`npm dist-tag ls devforgekit` -> `latest: 3.0.1, next: 3.0.1-rc1` - a
plain `npm publish` (no `--tag`) correctly moved `latest` to the new
stable version by default, while `next` stayed pointed at the RC,
exactly the intended behavior for the first stable release (no manual
dist-tag changes were needed or made). `npm view devforgekit@3.0.1 bin`
confirms the corrected bin field (`"devforgekit": "devforgekit"`) is
live on the published version. Full end-to-end verification: a real
`npm install -g devforgekit --prefix <scratch>` into an isolated scratch
prefix, confirming the postinstall-skip self-heal fires as documented
(`Setting up the DevForgeKit CLI (first run only)...`), then
`devforgekit --version` (`3.0.1`), `--help`, and `check` (a real
component-health scan) all working against the installed copy - torn
down afterward (`npm uninstall -g` + prefix removal), leaving no trace
on this machine.
