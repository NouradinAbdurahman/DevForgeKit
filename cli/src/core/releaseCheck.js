// The Release Check Engine - the logic behind `devforgekit doctor
// --release-check`. One command that gives a real, verified PASS/FAIL
// answer to "is this checkout actually ready to release", instead of a
// developer manually re-deriving it from CHANGELOG.md, RELEASE.md, and
// a handful of ad-hoc commands each time. Every check here does real
// work (reads real files, calls the same registry functions `registry
// audit/lint/format` use, shells out to `git`/`gh`) - nothing is
// inferred or assumed.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { repoRoot, cliRoot } from "./paths.js";
import { captureShellCommandWithDetails } from "./shell.js";
import { loadRegistry } from "./registry.js";
import { lintRegistry } from "./registryLint.js";
import { formatRegistry } from "./registryFormat.js";
import { computeRegistryAudit } from "../commands/registry.js";

// check(name, status, message) -> a single structured result.
// status: "pass" | "fail" | "warn" | "skip"
function check(name, status, message) {
    return { name, status, message };
}

// --- Version consistency -------------------------------------------------

// extractFormulaVersion(formulaText) -> "3.0.0" from a line like
//   url "https://github.com/.../archive/refs/tags/v3.0.0.tar.gz"
// Returns null if no version-shaped tag reference is found - the
// caller treats that as its own failure, not this function guessing.
export function extractFormulaVersion(formulaText) {
    const match = formulaText.match(/archive\/refs\/tags\/v(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\.tar\.gz/);
    return match ? match[1] : null;
}

export function checkVersionConsistency({ root = repoRoot() } = {}) {
    const sources = {};
    try {
        sources.VERSION = readFileSync(path.join(root, "VERSION"), "utf8").trim();
    } catch {
        return check("Version consistency", "fail", "VERSION file is missing or unreadable");
    }

    try {
        sources["package.json"] = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
    } catch {
        return check("Version consistency", "fail", "package.json is missing or unreadable");
    }

    try {
        sources["cli/package.json"] = JSON.parse(readFileSync(path.join(cliRoot(), "package.json"), "utf8")).version;
    } catch {
        return check("Version consistency", "fail", "cli/package.json is missing or unreadable");
    }

    try {
        const formulaText = readFileSync(path.join(root, "Formula", "devforgekit.rb"), "utf8");
        const formulaVersion = extractFormulaVersion(formulaText);
        sources["Formula/devforgekit.rb"] = formulaVersion ?? "(no version-shaped tag reference found)";
    } catch {
        return check("Version consistency", "fail", "Formula/devforgekit.rb is missing or unreadable");
    }

    const values = Object.values(sources);
    const allMatch = values.every((v) => v === values[0]);
    const summary = Object.entries(sources).map(([k, v]) => `${k}=${v}`).join(", ");

    if (!allMatch) {
        return check("Version consistency", "fail", `Version mismatch across sources: ${summary}`);
    }
    return check("Version consistency", "pass", `All sources agree on ${values[0]} (${summary})`);
}

// --- Release tag ----------------------------------------------------------

export async function checkReleaseTag({ execImpl = captureShellCommandWithDetails, root = repoRoot() } = {}) {
    const tagResult = await execImpl("git describe --exact-match --tags HEAD 2>/dev/null", { timeoutMs: 5000 });
    const tag = tagResult.stdout.trim();
    if (!tag) {
        return check("Release tag", "skip", "HEAD is not currently on a tag - not a release commit yet");
    }
    let version;
    try {
        version = readFileSync(path.join(root, "VERSION"), "utf8").trim();
    } catch {
        return check("Release tag", "fail", "VERSION file is missing or unreadable");
    }
    const expectedTag = `v${version}`;
    if (tag !== expectedTag) {
        return check("Release tag", "fail", `HEAD is tagged '${tag}' but VERSION says '${version}' (expected '${expectedTag}')`);
    }
    return check("Release tag", "pass", `HEAD is correctly tagged ${tag}`);
}

// --- Documentation ----------------------------------------------------------

const REQUIRED_DOCS = ["LICENSE", "README.md", "CHANGELOG.md", "RELEASE.md", "SECURITY.md"];

export function checkRequiredDocs({ root = repoRoot() } = {}) {
    const missing = [];
    const empty = [];
    for (const doc of REQUIRED_DOCS) {
        const filePath = path.join(root, doc);
        if (!existsSync(filePath)) {
            missing.push(doc);
            continue;
        }
        if (statSync(filePath).size === 0) empty.push(doc);
    }
    if (missing.length > 0) {
        return check("Required documentation", "fail", `Missing: ${missing.join(", ")}`);
    }
    if (empty.length > 0) {
        return check("Required documentation", "fail", `Empty: ${empty.join(", ")}`);
    }
    return check("Required documentation", "pass", `All present: ${REQUIRED_DOCS.join(", ")}`);
}

// --- Distribution artifacts -------------------------------------------------

const REQUIRED_ARTIFACTS = [
    "package.json",
    "Formula/devforgekit.rb",
    "scripts/npm-postinstall.sh",
    "completions/devforgekit.bash",
    "completions/devforgekit.zsh",
    "completions/devforgekit.fish"
];

export function checkDistributionArtifacts({ root = repoRoot() } = {}) {
    const missing = REQUIRED_ARTIFACTS.filter((rel) => !existsSync(path.join(root, rel)));
    if (missing.length > 0) {
        return check("Distribution artifacts", "fail", `Missing: ${missing.join(", ")}`);
    }
    return check("Distribution artifacts", "pass", `All present: ${REQUIRED_ARTIFACTS.join(", ")}`);
}

// --- Registry health --------------------------------------------------------

export function checkRegistry() {
    let lint;
    try {
        lint = lintRegistry();
    } catch (err) {
        return check("Registry", "fail", `registry lint threw: ${err.message}`);
    }
    if (lint.errors.length > 0) {
        return check("Registry", "fail", `registry lint: ${lint.errors.length} error(s)`);
    }

    let formatResults;
    try {
        formatResults = formatRegistry({ check: true });
    } catch (err) {
        return check("Registry", "fail", `registry format --check threw: ${err.message}`);
    }
    const unformatted = formatResults.filter((r) => r.changed);
    if (unformatted.length > 0) {
        return check("Registry", "fail", `registry format: ${unformatted.length} file(s) not canonically formatted (run 'devforgekit registry format')`);
    }

    let audit;
    try {
        audit = computeRegistryAudit(loadRegistry());
    } catch (err) {
        return check("Registry", "fail", `registry audit threw: ${err.message}`);
    }

    return check("Registry", "pass", `lint clean, format clean, quality score ${audit.averageQuality}%, ${lint.warnings.length} orphan/warning notice(s) (non-blocking)`);
}

// --- No TODO/FIXME in release code ------------------------------------------

function walkSourceFiles(dir, out = []) {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "test" || entry.name.startsWith(".")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walkSourceFiles(full, out);
        } else if (entry.name.endsWith(".js")) {
            out.push(full);
        }
    }
    return out;
}

// Matches a pending-work marker sitting immediately after a line- or
// block-comment opener - deliberately NOT a bare word-boundary match
// anywhere on the line, which would self-match this very function's own
// descriptive comments/strings (a real false positive hit during
// development: this file's own section header and check-name string
// both name the two marker keywords without being one themselves).
const MARKER_KEYWORDS = "TODO|FIXME";
const PENDING_MARKER_RE = new RegExp(`(//|/\\*|^\\s*\\*)\\s*(${MARKER_KEYWORDS})\\b`);

export function checkNoTodoFixme({ dir = path.join(cliRoot(), "src") } = {}) {
    const hits = [];
    for (const file of walkSourceFiles(dir)) {
        const content = readFileSync(file, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, i) => {
            if (PENDING_MARKER_RE.test(line)) {
                hits.push(`${path.relative(repoRoot(), file)}:${i + 1}`);
            }
        });
    }
    if (hits.length > 0) {
        return check("Outstanding pending-work markers", "fail", `Found ${hits.length}: ${hits.slice(0, 5).join(", ")}${hits.length > 5 ? ", ..." : ""}`);
    }
    return check("Outstanding pending-work markers", "pass", "None found in cli/src");
}

// --- Experimental flags ------------------------------------------------------

// The only "experimental" surface DevForgeKit currently has is the `ai`
// command family (see docs/ApiFreeze.md) - there is no config flag that
// toggles anything else on. What *is* checkable and meaningful here:
// debug/internal env vars (see docs/ApiFreeze.md's Internal
// classification) shouldn't be set in a clean release-testing
// environment - their presence is a signal this run isn't representative.
const INTERNAL_DEBUG_ENV_VARS = ["DEVFORGEKIT_DEBUG", "DEVFORGEKIT_TUI_DEBUG"];

export function checkNoExperimentalFlags({ env = process.env } = {}) {
    const set = INTERNAL_DEBUG_ENV_VARS.filter((name) => env[name]);
    if (set.length > 0) {
        return check("No experimental/debug flags enabled", "warn", `Set in this environment: ${set.join(", ")} - unset before a real release check`);
    }
    return check("No experimental/debug flags enabled", "pass", "No internal debug env vars set. Note: the ai command family is intentionally Experimental (see docs/ApiFreeze.md) - not a blocker.");
}

// --- Git working tree --------------------------------------------------------

export async function checkGitTreeClean({ execImpl = captureShellCommandWithDetails } = {}) {
    const result = await execImpl("git status --porcelain", { timeoutMs: 5000 });
    if (result.code !== 0) {
        return check("Git working tree", "fail", "git status failed - not a git repository?");
    }
    if (result.stdout.trim().length > 0) {
        const lines = result.stdout.trim().split("\n");
        return check("Git working tree", "fail", `${lines.length} uncommitted change(s): ${lines.slice(0, 3).join(", ")}${lines.length > 3 ? ", ..." : ""}`);
    }
    return check("Git working tree", "pass", "Clean");
}

// --- CI status ---------------------------------------------------------------

export async function checkCiStatus({ execImpl = captureShellCommandWithDetails } = {}) {
    const ghAuth = await execImpl("gh auth status", { timeoutMs: 5000 }).catch(() => ({ code: 1 }));
    if (ghAuth.code !== 0) {
        return check("CI status", "skip", "gh CLI not available/authenticated - cannot verify remote CI status");
    }
    const sha = await execImpl("git rev-parse HEAD", { timeoutMs: 5000 });
    if (sha.code !== 0) {
        return check("CI status", "fail", "Could not resolve HEAD commit");
    }
    const runs = await execImpl(`gh run list --commit ${sha.stdout.trim()} --limit 20 --json conclusion --jq '.[].conclusion'`, { timeoutMs: 15000 });
    if (runs.code !== 0) {
        return check("CI status", "skip", "Could not query GitHub Actions runs for this commit");
    }
    const conclusions = runs.stdout.trim().split("\n").filter(Boolean);
    if (conclusions.length === 0) {
        return check("CI status", "warn", "No GitHub Actions runs found yet for this commit");
    }
    const failures = conclusions.filter((c) => c === "failure");
    if (failures.length > 0) {
        return check("CI status", "fail", `${failures.length} of ${conclusions.length} run(s) failed for this commit`);
    }
    return check("CI status", "pass", `${conclusions.length} run(s) checked, none failed`);
}

// --- Orchestration ------------------------------------------------------------

// runReleaseCheck() -> { checks, ok }. `ok` is false if any check has
// status "fail" - "warn" and "skip" never block a release on their own
// (a warn is a signal to look closer, a skip means the check genuinely
// couldn't run in this environment, e.g. no network/no gh auth).
export async function runReleaseCheck() {
    const checks = [
        checkVersionConsistency(),
        await checkReleaseTag(),
        checkRequiredDocs(),
        checkDistributionArtifacts(),
        checkRegistry(),
        checkNoTodoFixme(),
        checkNoExperimentalFlags(),
        await checkGitTreeClean(),
        await checkCiStatus()
    ];
    const ok = checks.every((c) => c.status !== "fail");
    return { checks, ok };
}
