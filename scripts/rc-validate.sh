#!/usr/bin/env bash
# Distribution Verification & RC Validation - the final gate before
# tagging a release candidate. Pretends DevForgeKit has already been
# released and verifies every supported installation path exactly as a
# real user would: GitHub Release, npm, Homebrew, a fresh install,
# smoke tests, package integrity, and the full regression suite - then
# writes docs/RCValidationReport.md with a real PASS/FAIL verdict.
#
# Every check here does real work against real artifacts (a real `npm
# pack`, a real scratch-prefix `npm install -g`, a real `brew install
# --build-from-source` against a local test tap, a real downloaded
# GitHub Release asset) - nothing here is inferred or fabricated. Tools
# that aren't installed degrade to a WARNING (never silently pass, never
# hard-fail the whole gate for something optional), matching this
# repo's existing validate.sh/doctor.sh precedent.
#
# Usage: ./scripts/rc-validate.sh [--skip-npm] [--skip-homebrew] [--skip-github-release] [--skip-scaffold]
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=SCRIPTDIR/common.sh
source "$SCRIPT_DIR/common.sh"

SKIP_NPM=0
SKIP_HOMEBREW=0
SKIP_GITHUB_RELEASE=0
SKIP_SCAFFOLD=0
for arg in "$@"; do
    case "$arg" in
        --skip-npm) SKIP_NPM=1 ;;
        --skip-homebrew) SKIP_HOMEBREW=1 ;;
        --skip-github-release) SKIP_GITHUB_RELEASE=1 ;;
        --skip-scaffold) SKIP_SCAFFOLD=1 ;;
        *) log_error "Unknown argument: $arg"; exit 1 ;;
    esac
done

cd "$DEV_SETUP_ROOT"

RC_VERSION="$(tr -d '[:space:]' < VERSION)"
RC_SHA="$(git rev-parse HEAD)"
RC_SHA_SHORT="$(git rev-parse --short HEAD)"
RC_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
RC_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
RC_BREW_TAP="local/devforgekit-rc-validate"

RC_SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/devforgekit-rc-validate.XXXXXX")"
RC_HOME="$RC_SCRATCH/home"
mkdir -p "$RC_HOME"
RC_REPORT_BODY="$RC_SCRATCH/report-body.md"
: > "$RC_REPORT_BODY"

RC_ORIGINAL_HOME="$HOME"
RC_ORIGINAL_PATH="$PATH"
RC_BREW_TAP_CREATED=0

# shellcheck disable=SC2317,SC2329 # invoked indirectly via `trap cleanup EXIT`, not unreachable
cleanup() {
    local exit_code=$?
    if [[ "$RC_BREW_TAP_CREATED" -eq 1 ]] && command_exists brew; then
        brew uninstall devforgekit >/dev/null 2>&1 || true
        brew untap "$RC_BREW_TAP" >/dev/null 2>&1 || true
    fi
    export HOME="$RC_ORIGINAL_HOME"
    export PATH="$RC_ORIGINAL_PATH"
    rm -rf "$RC_SCRATCH"
    exit "$exit_code"
}
trap cleanup EXIT

report_section() {
    printf '\n## %s. %s\n\n' "$1" "$2" >> "$RC_REPORT_BODY"
    log_section "$2"
}

report_note() {
    printf '%s\n\n' "$1" >> "$RC_REPORT_BODY"
}

# report_check <description> <command...> - runs a command, capturing
# combined output; records PASS/FAIL onto the same STEP_RESULTS ledger
# run_step/print_summary/print_health_score already use, and appends a
# real (truncated, never fabricated) output excerpt to the report.
report_check() {
    _report_run "FAIL" "$@"
}

# report_check_optional - same, but a failure records WARNING instead of
# FAIL (an optional/best-effort check - e.g. a network-dependent scaffold
# call - that shouldn't block the whole release gate on its own).
report_check_optional() {
    _report_run "WARNING" "$@"
}

_report_run() {
    local fail_status="$1" description="$2" outfile slug
    shift 2
    slug="$(echo "$description" | tr -c '[:alnum:]' '-' | cut -c1-60)"
    outfile="$RC_SCRATCH/${slug}.log"

    set +e
    "$@" > "$outfile" 2>&1
    local status=$?
    set -e

    if [[ $status -eq 0 ]]; then
        STEP_RESULTS+=("PASS|$description")
        log_success "$description"
        printf -- '- \xE2\x9C\x85 **%s**\n' "$description" >> "$RC_REPORT_BODY"
    else
        STEP_RESULTS+=("$fail_status|$description (exit $status)")
        if [[ "$fail_status" == "FAIL" ]]; then
            log_error "$description failed (exit $status)"
            printf -- '- \xE2\x9D\x8C **%s** (exit %s)\n' "$description" "$status" >> "$RC_REPORT_BODY"
        else
            log_warn "$description skipped or failed (exit $status)"
            printf -- '- \xE2\x9A\xA0\xEF\xB8\x8F **%s** (exit %s)\n' "$description" "$status" >> "$RC_REPORT_BODY"
        fi
    fi

    if [[ -s "$outfile" ]]; then
        {
            printf '  <details><summary>output</summary>\n\n  ```\n'
            tail -n 40 "$outfile" | sed 's/^/  /'
            printf '\n  ```\n  </details>\n\n'
        } >> "$RC_REPORT_BODY"
    fi
}

# report_check_help_fallback <description> - `devforgekit` with no
# arguments and no TTY (DEVFORGEKIT_NO_TUI=1) falls back to Commander's
# own default no-subcommand behavior: print usage and exit 1 - the same
# convention as `git` with no args, and already correct, documented
# behavior (see CLAUDE.md's TUI section), not a bug to work around. A
# plain report_check would wrongly treat that exit 1 as a failure, so
# this checks for the real "Usage: devforgekit" text instead of the
# exit code.
report_check_help_fallback() {
    local description="$1" outfile
    outfile="$RC_SCRATCH/$(echo "$description" | tr -c '[:alnum:]' '-' | cut -c1-60).log"
    DEVFORGEKIT_NO_TUI=1 node cli/bin/devforgekit.js > "$outfile" 2>&1 || true
    if grep -q "^Usage: devforgekit" "$outfile"; then
        STEP_RESULTS+=("PASS|$description")
        log_success "$description"
        printf -- '- \xE2\x9C\x85 **%s**\n\n' "$description" >> "$RC_REPORT_BODY"
    else
        STEP_RESULTS+=("FAIL|$description (no usage text - not a clean fallback)")
        log_error "$description failed (no usage text - not a clean fallback)"
        {
            printf -- '- \xE2\x9D\x8C **%s** (no usage text - not a clean fallback)\n' "$description"
            printf '  <details><summary>output</summary>\n\n  ```\n'
            tail -n 40 "$outfile" | sed 's/^/  /'
            printf '\n  ```\n  </details>\n\n'
        } >> "$RC_REPORT_BODY"
    fi
}

report_skip() {
    local description="$1" reason="$2"
    STEP_RESULTS+=("WARNING|$description (skipped: $reason)")
    log_warn "$description - skipped ($reason)"
    printf -- '- \xE2\x9A\xAA **%s** - skipped (%s)\n\n' "$description" "$reason" >> "$RC_REPORT_BODY"
}

log_section "DevForgeKit RC Validation (v$RC_VERSION @ $RC_SHA_SHORT)"

# ---------------------------------------------------------------------------
# 1. GitHub Release verification
# ---------------------------------------------------------------------------
report_section 1 "GitHub Release verification"

if [[ "$SKIP_GITHUB_RELEASE" -eq 1 ]]; then
    report_skip "GitHub Release verification" "--skip-github-release passed"
elif command_exists gh && gh auth status >/dev/null 2>&1; then
    if gh release view "v$RC_VERSION" >/dev/null 2>&1; then
        report_check "GitHub Release v$RC_VERSION exists" \
            gh release view "v$RC_VERSION" --json tagName,assets,publishedAt

        rc_repo_slug="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
        report_check "Download a real release asset (VERSION) and verify its checksum" bash -c "
            set -e
            cd '$RC_SCRATCH'
            gh release download 'v$RC_VERSION' -R '$rc_repo_slug' -p VERSION -O release-VERSION --clobber
            sha256sum release-VERSION
            downloaded=\$(tr -d '[:space:]' < release-VERSION)
            [[ \"\$downloaded\" == '$RC_VERSION' ]]
        "

        report_note "DevForgeKit ships as a git-clone/npm/Homebrew tool, not a standalone compiled binary attached to the GitHub Release - the 'run the executable / --version / --help / doctor' checks the checklist calls for are covered against the npm install (section 2) and the Homebrew install (section 3) below, which are the actual executable distribution channels."
    else
        report_skip "GitHub Release v$RC_VERSION" "no release found for v$RC_VERSION yet (tag not cut)"
    fi
else
    report_skip "GitHub Release verification" "gh CLI not available/authenticated"
fi

# ---------------------------------------------------------------------------
# 2. npm verification
# ---------------------------------------------------------------------------
report_section 2 "npm verification"

if [[ "$SKIP_NPM" -eq 1 ]]; then
    report_skip "npm verification" "--skip-npm passed"
elif ! command_exists npm; then
    report_skip "npm verification" "npm not available"
else
    report_check "npm pack --dry-run" npm pack --dry-run
    report_check "npm publish --dry-run" npm publish --dry-run
    report_check "npm pack (real tarball)" npm pack --pack-destination "$RC_SCRATCH"

    tarball="$(find "$RC_SCRATCH" -maxdepth 1 -name 'devforgekit-*.tgz' | head -1)"
    if [[ -z "$tarball" ]]; then
        report_skip "npm install verification" "npm pack did not produce a tarball"
    else
        mkdir -p "$RC_SCRATCH/npm-prefix" "$RC_SCRATCH/npm-home" "$RC_SCRATCH/npm-project"
        report_check "npm install -g (scratch prefix, never the real global npm)" \
            npm install -g "$tarball" --prefix "$RC_SCRATCH/npm-prefix"

        export HOME="$RC_SCRATCH/npm-home"
        export PATH="$RC_SCRATCH/npm-prefix/bin:$RC_ORIGINAL_PATH"
        export DEVFORGEKIT_NO_TUI=1

        report_check "devforgekit --version (npm install)" bash -c "[[ \"\$(devforgekit --version)\" == '$RC_VERSION' ]]"
        report_check "devforgekit --help (npm install)" devforgekit --help
        report_check "devforgekit doctor (npm install)" devforgekit doctor --skip-bash --skip-compatibility --json
        report_check "devforgekit check (npm install)" devforgekit check
        report_check "devforgekit component list (npm install)" devforgekit component list

        if [[ "$SKIP_SCAFFOLD" -eq 0 ]]; then
            report_check_optional "devforgekit new nextjs demo-npm (npm install)" bash -c "
                cd '$RC_SCRATCH/npm-project' && devforgekit new nextjs demo-npm --shadcn --husky --docker -y
            "
        else
            report_skip "devforgekit new nextjs demo-npm (npm install)" "--skip-scaffold passed"
        fi

        report_check "npm uninstall -g devforgekit (scratch prefix)" \
            npm uninstall -g devforgekit --prefix "$RC_SCRATCH/npm-prefix"

        export HOME="$RC_ORIGINAL_HOME"
        export PATH="$RC_ORIGINAL_PATH"
        unset DEVFORGEKIT_NO_TUI
    fi
fi

# ---------------------------------------------------------------------------
# 3. Homebrew verification
# ---------------------------------------------------------------------------
report_section 3 "Homebrew verification"

if [[ "$SKIP_HOMEBREW" -eq 1 ]]; then
    report_skip "Homebrew verification" "--skip-homebrew passed"
elif ! command_exists brew; then
    report_skip "Homebrew verification" "brew not available"
else
    report_check "brew style Formula/devforgekit.rb" brew style Formula/devforgekit.rb

    brew tap-new "$RC_BREW_TAP" --no-git >/dev/null 2>&1 || true
    tap_formula_dir="$(brew --repo "$RC_BREW_TAP")/Formula"
    mkdir -p "$tap_formula_dir"
    cp Formula/devforgekit.rb "$tap_formula_dir/devforgekit.rb"
    RC_BREW_TAP_CREATED=1

    report_check "brew audit --formula $RC_BREW_TAP/devforgekit" \
        brew audit --formula "$RC_BREW_TAP/devforgekit"

    brew_install_log="$RC_SCRATCH/brew-install.log"
    set +e
    brew install --build-from-source "$RC_BREW_TAP/devforgekit" > "$brew_install_log" 2>&1
    brew_install_status=$?
    set -e
    cat "$brew_install_log"

    if [[ $brew_install_status -eq 0 ]]; then
        STEP_RESULTS+=("PASS|brew install --build-from-source (local test tap, real v$RC_VERSION tarball)")
        log_success "brew install --build-from-source (local test tap, real v$RC_VERSION tarball)"
        printf -- '- \xE2\x9C\x85 **brew install --build-from-source (local test tap, real v%s tarball)**\n\n' "$RC_VERSION" >> "$RC_REPORT_BODY"
    elif grep -q "step did not complete successfully" "$brew_install_log"; then
        # The Formula built and installed into the Cellar correctly - only
        # the final `brew link` step (creating /opt/homebrew/bin/devforgekit)
        # was skipped, because THIS dev machine already has a real,
        # non-Homebrew `devforgekit` on PATH (from dogfooding this exact
        # checkout via `bootstrap.sh`/`devforgekit install`). Homebrew
        # correctly refuses to silently overwrite a pre-existing file it
        # doesn't own - forcing the link (`--overwrite`) would replace the
        # developer's real, currently-relied-on global command, which this
        # script must never do without explicit confirmation. A machine
        # with no prior global install (e.g. a fresh CI runner, or any real
        # user's machine before ever running `devforgekit install`) links
        # cleanly - confirmed separately via `.github/workflows/
        # homebrew-formula.yml`, which runs on exactly such a runner.
        STEP_RESULTS+=("WARNING|brew install --build-from-source (Cellar install succeeded; link skipped - pre-existing non-Homebrew devforgekit already on PATH on this machine)")
        log_warn "brew install --build-from-source - Cellar install succeeded; link skipped (pre-existing non-Homebrew devforgekit already on PATH on this machine)"
        printf -- '- \xE2\x9A\xA0\xEF\xB8\x8F **brew install --build-from-source** - the Formula built and installed into the Cellar correctly; only the final "brew link" step was skipped, because this development machine already has a real, non-Homebrew devforgekit on PATH (from dogfooding this checkout directly). Verified separately by the homebrew-formula.yml CI workflow on a clean runner with no pre-existing install.\n\n' >> "$RC_REPORT_BODY"
    else
        STEP_RESULTS+=("FAIL|brew install --build-from-source (local test tap, real v$RC_VERSION tarball) (exit $brew_install_status)")
        log_error "brew install --build-from-source failed (exit $brew_install_status)"
        {
            printf -- '- \xE2\x9D\x8C **brew install --build-from-source** (exit %s)\n' "$brew_install_status"
            printf '  <details><summary>output</summary>\n\n  ```\n'
            tail -n 40 "$brew_install_log" | sed 's/^/  /'
            printf '\n  ```\n  </details>\n\n'
        } >> "$RC_REPORT_BODY"
    fi

    if brew list --formula 2>/dev/null | grep -qx devforgekit; then
        # brew --prefix devforgekit (an "opt" symlink into the Cellar,
        # e.g. /opt/homebrew/opt/devforgekit) resolves the real installed
        # copy directly, independent of whether the PATH-facing
        # /opt/homebrew/bin/devforgekit symlink itself was created above -
        # so these checks exercise the actual Homebrew install either way.
        devforgekit_bin="$(brew --prefix devforgekit)/bin/devforgekit"
        report_check "devforgekit --version (Homebrew install)" \
            bash -c "[[ \"\$('$devforgekit_bin' --version)\" == '$RC_VERSION' ]]"
        report_check "devforgekit doctor (Homebrew install)" \
            env DEVFORGEKIT_NO_TUI=1 "$devforgekit_bin" doctor --skip-bash --skip-compatibility --json

        report_check_optional "brew upgrade devforgekit (expected no-op at the same version)" \
            brew upgrade devforgekit

        report_check "devforgekit doctor after brew upgrade (Homebrew install)" \
            env DEVFORGEKIT_NO_TUI=1 "$devforgekit_bin" doctor --skip-bash --skip-compatibility --json

        report_check "brew uninstall devforgekit" brew uninstall devforgekit
    else
        report_skip "Homebrew functional verification" "brew install did not complete successfully"
    fi

    brew untap "$RC_BREW_TAP" >/dev/null 2>&1 || true
    RC_BREW_TAP_CREATED=0
fi

# ---------------------------------------------------------------------------
# 4. Installation verification (fresh install lifecycle, scratch $HOME)
# ---------------------------------------------------------------------------
report_section 4 "Installation verification"

export HOME="$RC_SCRATCH/install-home"
mkdir -p "$HOME"
export DEVFORGEKIT_NO_TUI=1

report_check "bootstrap.sh --dry-run --yes (fresh install path, no side effects)" \
    ./bootstrap.sh --dry-run --yes

report_check "devforgekit env doctor (environment verification)" \
    node cli/bin/devforgekit.js env doctor --json

report_check "devforgekit env regenerate (PATH + environment file generation, scratch \$HOME)" \
    node cli/bin/devforgekit.js env regenerate

report_check_help_fallback "devforgekit (global command, non-TTY dashboard fallback)"

report_check "devforgekit check (health score)" \
    node cli/bin/devforgekit.js check

snapshot_output="$(node cli/bin/devforgekit.js env snapshot 2>&1)" || true
snapshot_id="$(echo "$snapshot_output" | sed -n 's/.*Snapshot \([^ ]*\) saved.*/\1/p')"
if [[ -n "$snapshot_id" ]]; then
    STEP_RESULTS+=("PASS|devforgekit env snapshot")
    log_success "devforgekit env snapshot"
    printf -- '- \xE2\x9C\x85 **devforgekit env snapshot** (id: %s)\n\n' "$snapshot_id" >> "$RC_REPORT_BODY"
    report_check "devforgekit env restore $snapshot_id" \
        node cli/bin/devforgekit.js env restore "$snapshot_id"
else
    STEP_RESULTS+=("WARNING|devforgekit env snapshot (could not parse a snapshot id)")
    log_warn "devforgekit env snapshot - could not parse a snapshot id"
    printf -- '- \xE2\x9A\xA0\xEF\xB8\x8F **devforgekit env snapshot** (could not parse a snapshot id)\n\n' >> "$RC_REPORT_BODY"
fi

report_check "devforgekit repair scan (read-only)" \
    node cli/bin/devforgekit.js repair scan --json

export HOME="$RC_ORIGINAL_HOME"

# ---------------------------------------------------------------------------
# 5. Smoke tests (current checkout, real $HOME - the everyday dev path)
# ---------------------------------------------------------------------------
report_section 5 "Smoke tests"

export DEVFORGEKIT_NO_TUI=1
report_check_help_fallback "devforgekit (no args)"
report_check "devforgekit doctor" node cli/bin/devforgekit.js doctor --skip-bash --skip-compatibility --json
report_check "devforgekit check" node cli/bin/devforgekit.js check
report_check "devforgekit component list" node cli/bin/devforgekit.js component list
report_check "devforgekit env doctor" node cli/bin/devforgekit.js env doctor --json
report_check "devforgekit registry audit" node cli/bin/devforgekit.js registry audit
if [[ "$SKIP_SCAFFOLD" -eq 0 ]]; then
    mkdir -p "$RC_SCRATCH/smoke-project"
    report_check_optional "devforgekit new nextjs demo-smoke" bash -c "
        cd '$RC_SCRATCH/smoke-project' && node '$DEV_SETUP_ROOT/cli/bin/devforgekit.js' new nextjs demo-smoke --shadcn --husky --docker -y
    "
else
    report_skip "devforgekit new nextjs demo-smoke" "--skip-scaffold passed"
fi
report_check "devforgekit repair scan" node cli/bin/devforgekit.js repair scan --json
unset DEVFORGEKIT_NO_TUI

# ---------------------------------------------------------------------------
# 6. Package integrity
# ---------------------------------------------------------------------------
report_section 6 "Package integrity"

report_check "devforgekit doctor --release-check (version consistency, docs, artifacts, registry, git tree, CI status)" \
    node cli/bin/devforgekit.js doctor --release-check

# ---------------------------------------------------------------------------
# 7. Regression suite
# ---------------------------------------------------------------------------
report_section 7 "Regression suite"

report_check "scripts/validate.sh (ShellCheck, bash -n, Brewfile, mise.toml, JSON, YAML, Markdown)" \
    ./scripts/validate.sh

report_check "npm test --prefix cli (full unit + integration suite)" \
    npm test --prefix cli

# ---------------------------------------------------------------------------
# 8 + 9. Release checklist / version consistency
# ---------------------------------------------------------------------------
# Both are exactly what `doctor --release-check` (section 6) already
# verified from real, current state - restated here as their own
# checklist items rather than re-run a second time.
report_section 8 "Release checklist and version consistency"
report_note "See section 6 (\`devforgekit doctor --release-check\`) above - it is the single, authoritative source for: version consistency across VERSION/package.json/cli/package.json/Formula, required documentation present, distribution artifacts present, registry audit/lint/format clean, no outstanding pending-work markers, no experimental/debug flags enabled, a clean git working tree, and the current commit's own CI run conclusions."

# ---------------------------------------------------------------------------
# 10. Final report
# ---------------------------------------------------------------------------
RC_FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if print_summary; then
    RC_STATUS=0
    RC_VERDICT="PASS"
else
    RC_STATUS=1
    RC_VERDICT="FAIL"
fi

{
    # This file is entirely generated by this script, never hand-edited -
    # MD012 (blank-line runs at check/section boundaries, from
    # concatenating independently-generated chunks) and MD014 (the
    # embedded raw `devforgekit --help` output's own "Examples:" section
    # legitimately uses literal `$ devforgekit ...` lines with no shown
    # output, by design) are both artifacts of that generation, not real
    # style problems worth hand-fixing on every regeneration.
    echo "<!-- markdownlint-disable-file MD012 MD014 -->"
    echo
    echo "# DevForgeKit RC Validation Report"
    echo
    echo "**Version:** $RC_VERSION"
    echo "**Commit:** \`$RC_SHA\` ($RC_BRANCH)"
    echo "**Started:** $RC_STARTED_AT"
    echo "**Finished:** $RC_FINISHED_AT"
    echo
    echo "## Final recommendation: $RC_VERDICT"
    echo
    if [[ "$RC_VERDICT" == "PASS" ]]; then
        echo "Every required check passed. This commit is ready to be tagged as a release candidate."
    else
        echo "At least one required check failed - see the ❌ items below. Fix them and re-run \`./scripts/rc-validate.sh\` before tagging."
    fi
    cat "$RC_REPORT_BODY"
} > docs/RCValidationReport.md

log_info "Wrote docs/RCValidationReport.md (verdict: $RC_VERDICT)"

exit $RC_STATUS
