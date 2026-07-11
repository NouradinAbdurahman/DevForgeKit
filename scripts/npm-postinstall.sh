#!/usr/bin/env bash
# Runs automatically after `npm install -g devforgekit` (see the root
# package.json's "postinstall" script). Populates cli/node_modules -
# without it, the `devforgekit` dispatcher (this package's `bin` entry)
# falls back to its bash-only command table instead of the full Node CLI
# (see the "Layer 2 delegation" comment at the top of the `devforgekit`
# file). Mirrors ensure_cli_dependencies() in scripts/common.sh, with one
# deliberate difference: --omit=dev, since an end user installing via npm
# has no use for eslint/ink-testing-library.
#
# Never fails the npm install itself: a missing/failed CLI setup just
# means the dispatcher keeps using its bash fallback path, same
# philosophy as ensure_cli_dependencies(). A postinstall script that
# hard-fails `npm install -g` over a degradable problem would be worse
# than the degradation itself.
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI_DIR="$ROOT_DIR/cli"

[[ -f "$CLI_DIR/package.json" ]] || exit 0

if ! command -v npm >/dev/null 2>&1; then
    echo "devforgekit: npm not found on PATH - skipping CLI dependency install." >&2
    echo "devforgekit: the 'devforgekit' command will still work using its bash fallback." >&2
    echo "devforgekit: install Node.js/npm, then run: npm install --omit=dev --prefix \"$CLI_DIR\"" >&2
    exit 0
fi

cd "$CLI_DIR" || exit 0

if [[ -f package-lock.json ]]; then
    npm ci --omit=dev --no-audit --no-fund
else
    npm install --omit=dev --no-audit --no-fund
fi
status=$?

if [[ $status -ne 0 ]]; then
    echo "devforgekit: installing CLI dependencies failed (exit $status) - the 'devforgekit' command will still work using its bash fallback." >&2
    echo "devforgekit: retry manually with: npm install --omit=dev --prefix \"$CLI_DIR\"" >&2
fi

exit 0
