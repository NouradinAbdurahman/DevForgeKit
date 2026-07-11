# Distribution Readiness

Single source of truth for what can actually ship where, and why not yet
for everything else. Verified against real repo state, not assumed -
see the Evidence column. This is release-engineering scope, the last
step in the roadmap after RC1 dogfooding, not a pre-RC1 blocker.

| Channel | Status | Reason | Evidence |
|---|---|---|---|
| GitHub Release | **Ready** | Mechanism exists and is already exercised by real prior tags. | `.github/workflows/release.yml` fires on `v*.*.*`, verifies `VERSION` matches the tag, runs `validate.sh`, extracts the matching `CHANGELOG.md` section, generates a health report, and attaches `Brewfile`/`README.md`/`CHANGELOG.md`/`VERSION`/health report to the release. Nothing new to build - just cut the tag. |
| npm | **Pending** | `cli/package.json` is marked `"private": true` with no `publishConfig` - npm will refuse to publish as-is. Never dry-run tested against the registry. | `cli/package.json`: `"name": "@devforgekit/cli"`, `"private": true`, `"bin": {"devforgekit": "bin/devforgekit.js"}`. The scaffolding (scoped name, `bin` entry) is already correct; publishing itself is not yet configured or tested. |
| Homebrew | **Pending** | No formula or tap exists anywhere in this repo or a sibling `homebrew-devforgekit` tap. | `find . -iname "Formula*"` returns nothing. |
| Docker | **Pending** | No `Dockerfile` exists for packaging DevForgeKit itself. | `find . -iname "Dockerfile*"` returns nothing outside `templates/docker*` (those are project-generator templates for *generated* projects, not a package image for DevForgeKit itself). |
| Winget | **Blocked** | Windows registry coverage. | `registry/completeness-baseline.json`: `windows: 55` of 261 packages (21%) have verified Windows install steps. A Winget manifest that can't actually install most of the registry isn't a real release. |
| Chocolatey | **Blocked** | Windows registry coverage (same gate as Winget). | Same 55/261 figure. |
| Scoop | **Blocked** | Windows registry coverage (same gate as Winget). | Same 55/261 figure. |
| APT | **Blocked** | Linux registry coverage. | `registry/completeness-baseline.json`: `linux: 68` of 261 packages (26%) have verified Linux install steps. |
| Pacman | **Blocked** | Linux registry coverage (same gate as APT). | Same 68/261 figure. |
| RPM | **Blocked** | Linux registry coverage (same gate as APT). | Same 68/261 figure. |

## Status definitions

- **Ready** - the mechanism exists, has been exercised for real, and
  needs no new engineering to use again.
- **Pending** - self-inflicted, not externally gated. The work is
  well-understood and entirely within this repo's control (write a
  formula, write a Dockerfile, flip a `package.json` flag and dry-run
  publish) - just not done yet. No architectural blocker.
- **Blocked** - gated on something outside this specific channel's own
  work: here, that's Windows/Linux registry completeness (`registry/
  research-queue.md` tracks the remaining packages). Building a Winget
  manifest today would ship a package manager that can't install 79% of
  the registry - not a real release, regardless of how polished the
  manifest itself is.

## Why registry coverage gates three channels each

Windows and Linux coverage are single numbers that each gate three
package managers (Winget/Chocolatey/Scoop share the Windows number; APT/
Pacman/RPM share the Linux number) - closing the coverage gap once in
`registry/research-queue.md` unblocks three channels at once per
platform, not three separate research efforts. This is the same
constraint already called out in `docs/ReleaseCandidateChecklist.md`'s
"Cross Platform: Partial" row and is real data-verification work, not
engineering.

## Ordering

Per the roadmap, distribution work starts only after `v3.0.0-rc1` is cut
and dogfooded, in this order: **GitHub Release → Website → npm →
Homebrew → Docker → Winget → Chocolatey → Scoop.** The three
registry-coverage-blocked channels naturally land last since nothing
else unblocks them faster than closing that gap.
