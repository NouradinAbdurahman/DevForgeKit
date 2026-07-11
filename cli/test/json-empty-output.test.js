// Regression guard for a real bug found during the v3.0.0 backward
// compatibility sweep: `repair history --json` and `benchmark history
// --json` both checked "history is empty" before checking "--json was
// requested", so an empty result printed a human-readable sentence
// (e.g. "No repair records found...") on stdout instead of valid JSON -
// silently breaking any script parsing --json output the moment there
// was nothing to report. Fixed by checking opts.json first in both
// command handlers; this proves the fix against the real CLI binary
// with a genuinely empty, freshly-created HOME.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliBin = fileURLToPath(new URL("../bin/devforgekit.js", import.meta.url));

function runJsonAgainstEmptyHome(args) {
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-json-empty-test-"));
    try {
        const stdout = execFileSync(process.execPath, [cliBin, ...args], {
            stdio: "pipe",
            env: { ...process.env, HOME: tempHome, DEVFORGEKIT_NO_TUI: "1" }
        });
        return JSON.parse(stdout.toString());
    } finally {
        rmSync(tempHome, { recursive: true, force: true });
    }
}

test("repair history --json emits a valid empty JSON array when no records exist", () => {
    const result = runJsonAgainstEmptyHome(["repair", "history", "--json"]);
    assert.deepEqual(result, []);
});

test("benchmark history --json emits a valid empty JSON array when no records exist", () => {
    const result = runJsonAgainstEmptyHome(["benchmark", "history", "--json"]);
    assert.deepEqual(result, []);
});
