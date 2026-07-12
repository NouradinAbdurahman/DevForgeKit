import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    extractFormulaVersion,
    checkVersionConsistency,
    checkReleaseTag,
    checkRequiredDocs,
    checkDistributionArtifacts,
    checkRegistry,
    checkNoTodoFixme,
    checkNoExperimentalFlags,
    checkGitTreeClean,
    checkCiStatus,
    runReleaseCheck
} from "../src/core/releaseCheck.js";

// Builds a scratch repo root with just enough real structure for the
// version/docs/artifacts checks to run against - never the real repo,
// so a test can freely assert both the "everything matches" and
// "something's wrong" paths without touching this checkout's own state.
function makeScratchRoot() {
    const root = mkdtempSync(path.join(tmpdir(), "devforgekit-releasecheck-test-"));
    mkdirSync(path.join(root, "cli"), { recursive: true });
    mkdirSync(path.join(root, "Formula"), { recursive: true });
    return root;
}

function writeVersionSources(root, version, formulaVersion = version) {
    writeFileSync(path.join(root, "VERSION"), `${version}\n`);
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "devforgekit", version }));
    writeFileSync(path.join(root, "cli", "package.json"), JSON.stringify({ name: "@devforgekit/cli", version }));
    writeFileSync(
        path.join(root, "Formula", "devforgekit.rb"),
        `class Devforgekit < Formula\n  url "https://github.com/x/y/archive/refs/tags/v${formulaVersion}.tar.gz"\nend\n`
    );
}

// Always async, and always awaited by callers (even for a sync fn) - the
// scratch root must not be removed until whatever fn returns has
// actually settled. fn's own throw (a failed assertion) becomes a
// rejected promise here since withScratchRoot itself is async; an
// un-awaited call would silently swallow that rejection and the test
// would falsely pass despite the assertion having failed.
async function withScratchRoot(fn) {
    const root = makeScratchRoot();
    try {
        return await fn(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

// A fake captureShellCommandWithDetails - tests supply canned responses
// keyed by a substring of the command, so no real git/gh process is ever
// spawned for these unit tests.
function fakeExec(responses) {
    return async (command) => {
        for (const [needle, result] of responses) {
            if (command.includes(needle)) return result;
        }
        throw new Error(`fakeExec: no canned response for '${command}'`);
    };
}

// ─── extractFormulaVersion ─────────────────────────────────────────────

test("extractFormulaVersion reads the version out of a tagged archive URL", () => {
    const text = 'url "https://github.com/foo/bar/archive/refs/tags/v3.0.0.tar.gz"';
    assert.equal(extractFormulaVersion(text), "3.0.0");
});

test("extractFormulaVersion handles a pre-release suffix", () => {
    const text = 'url "https://github.com/foo/bar/archive/refs/tags/v3.0.0-rc1.tar.gz"';
    assert.equal(extractFormulaVersion(text), "3.0.0-rc1");
});

test("extractFormulaVersion returns null when there's no version-shaped tag reference", () => {
    assert.equal(extractFormulaVersion('url "https://example.com/nope.tar.gz"'), null);
});

// ─── checkVersionConsistency ────────────────────────────────────────────

test("checkVersionConsistency passes when every source agrees", async () => {
    await withScratchRoot(async (root) => {
        writeVersionSources(root, "3.0.0");
        const result = checkVersionConsistency({ root });
        assert.equal(result.status, "pass");
    });
});

test("checkVersionConsistency fails when the Formula references a different version", async () => {
    await withScratchRoot(async (root) => {
        writeVersionSources(root, "3.0.0", "2.9.0");
        const result = checkVersionConsistency({ root });
        assert.equal(result.status, "fail");
        assert.match(result.message, /mismatch/i);
    });
});

test("checkVersionConsistency fails when VERSION is missing", async () => {
    await withScratchRoot(async (root) => {
        const result = checkVersionConsistency({ root });
        assert.equal(result.status, "fail");
        assert.match(result.message, /VERSION/);
    });
});

// ─── checkReleaseTag ─────────────────────────────────────────────────────

test("checkReleaseTag skips when HEAD is not on a tag", async () => {
    await withScratchRoot(async (root) => {
        writeVersionSources(root, "3.0.0");
        const exec = fakeExec([["git describe", { code: 1, stdout: "" }]]);
        const result = await checkReleaseTag({ execImpl: exec, root });
        assert.equal(result.status, "skip");
    });
});

test("checkReleaseTag passes when the tag matches VERSION", async () => {
    await withScratchRoot(async (root) => {
        writeVersionSources(root, "3.0.0");
        const exec = fakeExec([["git describe", { code: 0, stdout: "v3.0.0\n" }]]);
        const result = await checkReleaseTag({ execImpl: exec, root });
        assert.equal(result.status, "pass");
    });
});

test("checkReleaseTag fails when the tag doesn't match VERSION", async () => {
    await withScratchRoot(async (root) => {
        writeVersionSources(root, "3.0.0");
        const exec = fakeExec([["git describe", { code: 0, stdout: "v2.9.0\n" }]]);
        const result = await checkReleaseTag({ execImpl: exec, root });
        assert.equal(result.status, "fail");
    });
});

// ─── checkRequiredDocs ────────────────────────────────────────────────────

test("checkRequiredDocs fails when a required doc is missing", async () => {
    await withScratchRoot(async (root) => {
        const result = checkRequiredDocs({ root });
        assert.equal(result.status, "fail");
        assert.match(result.message, /Missing/);
    });
});

test("checkRequiredDocs fails when a required doc is present but empty", async () => {
    await withScratchRoot(async (root) => {
        for (const doc of ["LICENSE", "README.md", "CHANGELOG.md", "RELEASE.md", "SECURITY.md"]) {
            writeFileSync(path.join(root, doc), doc === "README.md" ? "" : "content\n");
        }
        const result = checkRequiredDocs({ root });
        assert.equal(result.status, "fail");
        assert.match(result.message, /Empty/);
    });
});

test("checkRequiredDocs passes when every doc exists and is non-empty", async () => {
    await withScratchRoot(async (root) => {
        for (const doc of ["LICENSE", "README.md", "CHANGELOG.md", "RELEASE.md", "SECURITY.md"]) {
            writeFileSync(path.join(root, doc), "content\n");
        }
        const result = checkRequiredDocs({ root });
        assert.equal(result.status, "pass");
    });
});

// ─── checkDistributionArtifacts ──────────────────────────────────────────

test("checkDistributionArtifacts fails when artifacts are missing", async () => {
    await withScratchRoot(async (root) => {
        const result = checkDistributionArtifacts({ root });
        assert.equal(result.status, "fail");
    });
});

test("checkDistributionArtifacts passes when every artifact exists", async () => {
    await withScratchRoot(async (root) => {
        writeFileSync(path.join(root, "package.json"), "{}");
        writeFileSync(path.join(root, "Formula", "devforgekit.rb"), "");
        mkdirSync(path.join(root, "scripts"), { recursive: true });
        writeFileSync(path.join(root, "scripts", "npm-postinstall.sh"), "");
        mkdirSync(path.join(root, "completions"), { recursive: true });
        for (const shell of ["bash", "zsh", "fish"]) {
            writeFileSync(path.join(root, "completions", `devforgekit.${shell}`), "");
        }
        const result = checkDistributionArtifacts({ root });
        assert.equal(result.status, "pass");
    });
});

// ─── checkNoTodoFixme ─────────────────────────────────────────────────────

test("checkNoTodoFixme finds a real TODO marker comment", async () => {
    await withScratchRoot(async (root) => {
        const srcDir = path.join(root, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(path.join(srcDir, "thing.js"), "function f() {\n    // TODO: finish this\n    return 1;\n}\n");
        const result = checkNoTodoFixme({ dir: srcDir });
        assert.equal(result.status, "fail");
        assert.match(result.message, /thing\.js:2/);
    });
});

test("checkNoTodoFixme ignores the word TODO/FIXME appearing in a non-comment string or descriptive comment", async () => {
    await withScratchRoot(async (root) => {
        const srcDir = path.join(root, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(
            path.join(srcDir, "thing.js"),
            [
                'const message = "no TODO or FIXME markers here";',
                "// this comment discusses TODO and FIXME as concepts, not as a marker",
                "return message;"
            ].join("\n")
        );
        const result = checkNoTodoFixme({ dir: srcDir });
        assert.equal(result.status, "pass");
    });
});

test("checkNoTodoFixme finds a FIXME in a block comment continuation line", async () => {
    await withScratchRoot(async (root) => {
        const srcDir = path.join(root, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(path.join(srcDir, "thing.js"), "/**\n * FIXME broken under load\n */\n");
        const result = checkNoTodoFixme({ dir: srcDir });
        assert.equal(result.status, "fail");
    });
});

test("checkNoTodoFixme passes on a directory with no JS files", async () => {
    await withScratchRoot(async (root) => {
        const result = checkNoTodoFixme({ dir: path.join(root, "does-not-exist") });
        assert.equal(result.status, "pass");
    });
});

// ─── checkNoExperimentalFlags ────────────────────────────────────────────

test("checkNoExperimentalFlags passes with a clean env", () => {
    const result = checkNoExperimentalFlags({ env: {} });
    assert.equal(result.status, "pass");
});

test("checkNoExperimentalFlags warns when DEVFORGEKIT_DEBUG is set", () => {
    const result = checkNoExperimentalFlags({ env: { DEVFORGEKIT_DEBUG: "1" } });
    assert.equal(result.status, "warn");
    assert.match(result.message, /DEVFORGEKIT_DEBUG/);
});

// ─── checkGitTreeClean ────────────────────────────────────────────────────

test("checkGitTreeClean passes on an empty git status", async () => {
    const exec = fakeExec([["git status", { code: 0, stdout: "" }]]);
    const result = await checkGitTreeClean({ execImpl: exec });
    assert.equal(result.status, "pass");
});

test("checkGitTreeClean fails when there are uncommitted changes", async () => {
    const exec = fakeExec([["git status", { code: 0, stdout: " M cli/src/foo.js\n?? new-file.txt\n" }]]);
    const result = await checkGitTreeClean({ execImpl: exec });
    assert.equal(result.status, "fail");
    assert.match(result.message, /2 uncommitted/);
});

// ─── checkCiStatus ────────────────────────────────────────────────────────

test("checkCiStatus skips when gh is not authenticated", async () => {
    const exec = fakeExec([["gh auth status", { code: 1, stdout: "" }]]);
    const result = await checkCiStatus({ execImpl: exec });
    assert.equal(result.status, "skip");
});

test("checkCiStatus passes when no run failed", async () => {
    const exec = fakeExec([
        ["gh auth status", { code: 0, stdout: "" }],
        ["git rev-parse HEAD", { code: 0, stdout: "abc123\n" }],
        ["gh run list", { code: 0, stdout: "success\nsuccess\n" }]
    ]);
    const result = await checkCiStatus({ execImpl: exec });
    assert.equal(result.status, "pass");
});

test("checkCiStatus fails when a run failed", async () => {
    const exec = fakeExec([
        ["gh auth status", { code: 0, stdout: "" }],
        ["git rev-parse HEAD", { code: 0, stdout: "abc123\n" }],
        ["gh run list", { code: 0, stdout: "success\nfailure\n" }]
    ]);
    const result = await checkCiStatus({ execImpl: exec });
    assert.equal(result.status, "fail");
});

test("checkCiStatus warns when no runs are found yet for the commit", async () => {
    const exec = fakeExec([
        ["gh auth status", { code: 0, stdout: "" }],
        ["git rev-parse HEAD", { code: 0, stdout: "abc123\n" }],
        ["gh run list", { code: 0, stdout: "" }]
    ]);
    const result = await checkCiStatus({ execImpl: exec });
    assert.equal(result.status, "warn");
});

// ─── checkRegistry (integration - runs against this real repo's registry) ─

test("checkRegistry returns a structured pass/fail result against the real registry", () => {
    const result = checkRegistry();
    assert.equal(result.name, "Registry");
    assert.ok(["pass", "fail"].includes(result.status));
    assert.equal(typeof result.message, "string");
});

// ─── runReleaseCheck orchestration ───────────────────────────────────────

test("runReleaseCheck's ok is false whenever any check fails, true otherwise", async () => {
    const { checks, ok } = await runReleaseCheck();
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
    const anyFail = checks.some((c) => c.status === "fail");
    assert.equal(ok, !anyFail);
});
