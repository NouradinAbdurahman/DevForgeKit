import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setPlatformForTesting, resetPlatformForTesting, LinuxPlatform } from "../src/core/platform/index.js";
import { getPackage } from "../src/core/registry.js";
import { resolveInstallStep } from "../src/core/installer.js";

import {
    REPAIR_VERSION,
    REPAIR_DIR,
    REPAIR_CATEGORIES,
    CATEGORY_LABELS,
    RISK_LEVELS,
    RISK_LABELS,
    ACTION_TYPES,
    planRepairs,
    dryRunPlan,
    computeQualityScore,
    validatePrerequisites,
    rollbackRepairResult,
    saveRepairRecord,
    listHistory,
    getRepairRecord,
    deleteRepairRecord,
    cleanHistory,
    exportRecord,
    scanIssues,
    verifyRepairs,
    createRollbackPoint,
    explainRepair,
    explainPlan,
    listRollbackPoints,
    previewRollback,
    scanCliInstallIssues
} from "../src/core/repair.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.devforgekit (same pattern as snapshot.test.js and benchmark.test.js).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Constants ────────────────────────────────────────────────────────

test("REPAIR_VERSION is 2", () => {
    assert.equal(REPAIR_VERSION, 2);
});

test("REPAIR_DIR is 'repairs'", () => {
    assert.equal(REPAIR_DIR, "repairs");
});

// ─── planRepairs ──────────────────────────────────────────────────────

test("planRepairs returns empty plan for no issues", () => {
    const plan = planRepairs([]);
    assert.equal(plan.totalRepairs, 0);
    assert.equal(plan.totalInfo, 0);
    assert.deepEqual(plan.issues, []);
    assert.deepEqual(plan.informational, []);
});

test("planRepairs separates repairable from informational issues", () => {
    const issues = [
        { id: "1", severity: "CRITICAL", category: "test", subsystem: "test", description: "critical issue", fix: "fix it", estimatedTime: "5 min", dependencies: [] },
        { id: "2", severity: "WARNING", category: "test", subsystem: "test", description: "warning issue", fix: "fix it too", estimatedTime: "2 min", dependencies: [] },
        { id: "3", severity: "INFO", category: "test", subsystem: "test", description: "info issue", fix: "consider this", estimatedTime: "1 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.totalRepairs, 2);
    assert.equal(plan.totalInfo, 1);
    assert.equal(plan.informational.length, 1);
    assert.equal(plan.informational[0].id, "3");
});

test("planRepairs sorts by severity (critical first)", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "warning", fix: "fix", estimatedTime: "2 min", dependencies: [] },
        { id: "2", severity: "CRITICAL", category: "test", subsystem: "test", description: "critical", fix: "fix", estimatedTime: "5 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.issues[0].severity, "CRITICAL");
    assert.equal(plan.issues[1].severity, "WARNING");
});

test("planRepairs respects dependency ordering", () => {
    const issues = [
        { id: "a", severity: "WARNING", category: "test", subsystem: "test", description: "depends on b", fix: "fix a", estimatedTime: "1 min", dependencies: ["b"] },
        { id: "b", severity: "WARNING", category: "test", subsystem: "test", description: "no deps", fix: "fix b", estimatedTime: "1 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    // "b" should come before "a" because "a" depends on "b"
    const aIndex = plan.issues.findIndex((i) => i.id === "a");
    const bIndex = plan.issues.findIndex((i) => i.id === "b");
    assert.ok(bIndex < aIndex, "dependency should be repaired first");
});

test("planRepairs handles cycle in dependencies gracefully", () => {
    const issues = [
        { id: "a", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix a", estimatedTime: "1 min", dependencies: ["b"] },
        { id: "b", severity: "WARNING", category: "test", subsystem: "test", description: "b", fix: "fix b", estimatedTime: "1 min", dependencies: ["a"] }
    ];
    // Should not hang or throw
    const plan = planRepairs(issues);
    assert.equal(plan.totalRepairs, 2);
});

test("planRepairs calculates estimated time", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix", estimatedTime: "5 min", dependencies: [] },
        { id: "2", severity: "WARNING", category: "test", subsystem: "test", description: "b", fix: "fix", estimatedTime: "3 min", dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.estimatedTime, "8 min");
});

test("planRepairs detects restart requirement", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix", estimatedTime: "1 min", requiresRestart: true, dependencies: [] }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.requiresRestart, true);
});

// ─── saveRepairRecord / listHistory / getRepairRecord / deleteRepairRecord ─

test("saveRepairRecord writes a JSON file to ~/.devforgekit/repairs/", () => {
    withTempHome(() => {
        const record = {
            id: "test-repair-123",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 0,
            failed: 0,
            skipped: 0,
            durationMs: 5000,
            machine: { hostname: "test" }
        };
        const filePath = saveRepairRecord(record);
        assert.ok(existsSync(filePath));
        assert.ok(filePath.endsWith("test-repair-123.json"));
    });
});

test("listHistory returns empty array when no repairs directory exists", () => {
    withTempHome(() => {
        const history = listHistory();
        assert.deepEqual(history, []);
    });
});

test("listHistory returns saved records sorted by date (newest first)", () => {
    withTempHome(() => {
        saveRepairRecord({
            id: "old-repair",
            createdAt: "2025-01-01T00:00:00.000Z",
            issues: [],
            fixed: 1,
            failed: 0,
            skipped: 0,
            durationMs: 3000
        });
        saveRepairRecord({
            id: "new-repair",
            createdAt: "2025-06-01T00:00:00.000Z",
            issues: [],
            fixed: 2,
            failed: 0,
            skipped: 0,
            durationMs: 5000
        });

        const history = listHistory();
        assert.equal(history.length, 2);
        assert.equal(history[0].id, "new-repair");
        assert.equal(history[1].id, "old-repair");
    });
});

test("getRepairRecord reads a saved repair record", () => {
    withTempHome(() => {
        const record = {
            id: "get-test",
            createdAt: new Date().toISOString(),
            issues: [{ id: "i1", severity: "WARNING", description: "test issue" }],
            fixed: 1,
            failed: 0,
            skipped: 0,
            durationMs: 2000,
            machine: { hostname: "test" }
        };
        saveRepairRecord(record);
        const loaded = getRepairRecord("get-test");
        assert.equal(loaded.id, "get-test");
        assert.equal(loaded.fixed, 1);
        assert.equal(loaded.issues.length, 1);
    });
});

test("getRepairRecord throws for non-existent id", () => {
    withTempHome(() => {
        assert.throws(
            () => getRepairRecord("nonexistent"),
            /not found/
        );
    });
});

test("deleteRepairRecord removes a repair record file", () => {
    withTempHome(() => {
        const record = {
            id: "delete-test",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 0,
            failed: 0,
            skipped: 0,
            durationMs: 1000
        };
        const filePath = saveRepairRecord(record);
        assert.ok(existsSync(filePath));

        const deleted = deleteRepairRecord("delete-test");
        assert.equal(deleted, filePath);
        assert.ok(!existsSync(filePath));
    });
});

test("deleteRepairRecord throws for non-existent id", () => {
    withTempHome(() => {
        assert.throws(
            () => deleteRepairRecord("nonexistent"),
            /not found/
        );
    });
});

// ─── cleanHistory ─────────────────────────────────────────────────────

test("cleanHistory deletes all repair records", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "r1", createdAt: "2025-01-01T00:00:00Z", issues: [], fixed: 0, failed: 0, skipped: 0, durationMs: 1000 });
        saveRepairRecord({ id: "r2", createdAt: "2025-02-01T00:00:00Z", issues: [], fixed: 0, failed: 0, skipped: 0, durationMs: 1000 });

        const result = cleanHistory();
        assert.equal(result.deleted, 2);

        const history = listHistory();
        assert.equal(history.length, 0);
    });
});

test("cleanHistory returns 0 when no repairs directory exists", () => {
    withTempHome(() => {
        const result = cleanHistory();
        assert.equal(result.deleted, 0);
    });
});

// ─── exportRecord ─────────────────────────────────────────────────────

test("exportRecord produces valid JSON", () => {
    const record = {
        id: "export-test",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 5000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [{ id: "i1", severity: "WARNING", category: "test", subsystem: "test", description: "test", fix: "fix it", estimatedTime: "1 min" }],
        fixed: 1,
        failed: 0,
        skipped: 0,
        repairResults: [{ issue: { description: "test" }, ok: true }],
        verification: { results: [{ check: "Compatibility", status: "PASS", score: 100 }], health: { score: 100, verdict: "Machine Ready" } }
    };
    const json = exportRecord(record, "json");
    const parsed = JSON.parse(json);
    assert.equal(parsed.id, "export-test");
    assert.equal(parsed.fixed, 1);
});

test("exportRecord produces valid Markdown", () => {
    const record = {
        id: "export-md",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 5000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [{ id: "i1", severity: "WARNING", category: "test", subsystem: "test", description: "test issue", fix: "fix it", estimatedTime: "1 min" }],
        fixed: 1,
        failed: 0,
        skipped: 0,
        repairResults: [{ issue: { description: "test issue" }, ok: true }],
        verification: { results: [{ check: "Compatibility", status: "PASS", score: 100 }], health: { score: 100, verdict: "Machine Ready" } },
        benchmarkBefore: { overallScore: 70, overallGrade: "C" },
        benchmarkAfter: { overallScore: 85, overallGrade: "B" }
    };
    const md = exportRecord(record, "markdown");
    assert.ok(md.includes("# Repair Report"));
    assert.ok(md.includes("## Summary"));
    assert.ok(md.includes("## Issues"));
    assert.ok(md.includes("## Repair Results"));
    assert.ok(md.includes("## Verification"));
    assert.ok(md.includes("## Benchmark Comparison"));
});

test("exportRecord produces valid HTML", () => {
    const record = {
        id: "export-html",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 3000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [{ id: "i1", severity: "CRITICAL", category: "test", subsystem: "test", description: "critical issue", fix: "fix it", estimatedTime: "5 min" }],
        fixed: 0,
        failed: 1,
        skipped: 0
    };
    const html = exportRecord(record, "html");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("<title>Repair Report"));
    assert.ok(html.includes("critical issue"));
});

test("exportRecord produces valid CSV", () => {
    const record = {
        id: "export-csv",
        createdAt: "2025-01-01T00:00:00.000Z",
        durationMs: 3000,
        devforgekitVersion: "1.3.4",
        machine: { hostname: "test" },
        issues: [
            { id: "i1", severity: "WARNING", category: "path", subsystem: "shell", description: "missing dir", fix: "remove it", estimatedTime: "1 min" },
            { id: "i2", severity: "CRITICAL", category: "docker", subsystem: "docker", description: "daemon down", fix: "start docker", estimatedTime: "30 sec" }
        ],
        fixed: 1,
        failed: 1,
        skipped: 0
    };
    const csv = exportRecord(record, "csv");
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "id,severity,category,subsystem,description,fix,estimated_time");
    assert.ok(lines.length >= 3);
    assert.ok(lines[1].includes("i1,WARNING,path,shell"));
    assert.ok(lines[2].includes("i2,CRITICAL,docker,docker"));
});

test("exportRecord throws for unknown format", () => {
    const record = { id: "x", issues: [] };
    assert.throws(
        () => exportRecord(record, "xml"),
        /Unknown export format/
    );
});

// ─── Integration: scanIssues ──────────────────────────────────────────

test("scanIssues returns an array of issues", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-scan-"));
    process.env.HOME = tempHome;

    try {
        const issues = await scanIssues();
        assert.ok(Array.isArray(issues));
        // Each issue should have required fields
        for (const issue of issues) {
            assert.ok(issue.id, "issue should have an id");
            assert.ok(issue.severity, "issue should have a severity");
            assert.ok(issue.category, "issue should have a category");
            assert.ok(issue.subsystem, "issue should have a subsystem");
            assert.ok(issue.description, "issue should have a description");
        }
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("scanIssues calls onProgress callback", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-progress-"));
    process.env.HOME = tempHome;

    try {
        const progressCalls = [];
        await scanIssues({
            onProgress: (p) => progressCalls.push(p)
        });

        assert.ok(progressCalls.length > 0, "onProgress should be called");
        assert.ok(progressCalls.some((p) => p.status === "running" || p.status === "done"));
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// Regression test for a real bug: `repair scan --json` (and `plan`/
// `explain-issues`/`run --json`) used to print scanIssues()'s progress
// banner (logger.section/info/success - all console.log, i.e. stdout)
// unconditionally, corrupting the JSON payload the same command printed
// right after it - any script piping the output through `jq` broke
// immediately. `silent: true` must suppress every line scanIssues()
// would otherwise print while still returning the full, real issue list.
test("scanIssues({ silent: true }) prints nothing to stdout/stderr but still returns real issues", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-silent-"));
    process.env.HOME = tempHome;

    const originalLog = console.log;
    const originalError = console.error;
    const logged = [];
    console.log = (...args) => logged.push(args.join(" "));
    console.error = (...args) => logged.push(args.join(" "));

    try {
        const issues = await scanIssues({ silent: true });
        assert.ok(Array.isArray(issues));
        assert.deepEqual(logged, [], `expected zero console output, got: ${JSON.stringify(logged)}`);
    } finally {
        console.log = originalLog;
        console.error = originalError;
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("scanIssues() without silent still prints its usual progress banner (proves silent isn't a no-op)", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-not-silent-"));
    process.env.HOME = tempHome;

    const originalLog = console.log;
    const logged = [];
    console.log = (...args) => logged.push(args.join(" "));

    try {
        await scanIssues();
        assert.ok(logged.some((line) => line.includes("Repair Engine: Scan")));
    } finally {
        console.log = originalLog;
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: scanCliInstallIssues ─────────────────────────────────
// (pre-v3.0.0 "Installation Experience Excellence" - checks the global
// symlink, cli/node_modules, and ~/.config/devforgekit/install-state.json)

test("scanCliInstallIssues returns well-formed issues, all in the cli-install category", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-cli-install-"));
    process.env.HOME = tempHome;

    try {
        const issues = await scanCliInstallIssues();
        assert.ok(Array.isArray(issues));
        for (const issue of issues) {
            assert.equal(issue.category, REPAIR_CATEGORIES.CLI_INSTALL);
            assert.equal(issue.categoryLabel, "CLI Install");
            assert.ok(issue.id, "issue should have an id");
            assert.ok(issue.action, "issue should have a structured action");
            assert.equal(issue.action.type, ACTION_TYPES.SHELL);
            assert.match(issue.action.command, /repair_install\.sh/);
        }
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("scanCliInstallIssues reports failed packages recorded in install-state.json", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-cli-install-failed-"));
    process.env.HOME = tempHome;

    try {
        const configDir = path.join(tempHome, ".config", "devforgekit");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
            path.join(configDir, "install-state.json"),
            JSON.stringify({ flutter: "failed:cask", git: "installed:brew" }, null, 2)
        );

        const issues = await scanCliInstallIssues();
        const failedIssue = issues.find((i) => i.id === "cli-install-failed-packages");
        assert.ok(failedIssue, "expected an issue for the failed package");
        assert.match(failedIssue.description, /flutter/);
        assert.doesNotMatch(failedIssue.description, /\bgit\b/, "an installed package should not be reported as failed");
        assert.match(failedIssue.action.command, /repair_install\.sh['"]? packages/);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

test("scanCliInstallIssues reports no failed-packages issue when install-state.json has none", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-cli-install-clean-"));
    process.env.HOME = tempHome;

    try {
        const configDir = path.join(tempHome, ".config", "devforgekit");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(
            path.join(configDir, "install-state.json"),
            JSON.stringify({ git: "installed:brew", jq: "installed:brew" }, null, 2)
        );

        const issues = await scanCliInstallIssues();
        assert.ok(!issues.some((i) => i.id === "cli-install-failed-packages"));
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: verifyRepairs ───────────────────────────────────────

test("verifyRepairs returns verification results with health score", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-verify-"));
    process.env.HOME = tempHome;

    try {
        const result = await verifyRepairs();

        assert.ok(result.results);
        assert.ok(Array.isArray(result.results));
        assert.ok(result.results.length > 0);
        assert.ok(result.health);
        assert.ok(typeof result.health.score === "number");

        // Should include key verification checks
        const checks = result.results.map((r) => r.check);
        assert.ok(checks.includes("Compatibility"));
        assert.ok(checks.includes("Health Score"));
        assert.ok(checks.includes("Workspaces"));
        assert.ok(checks.includes("Plugins"));
        assert.ok(checks.includes("Configuration"));
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: createRollbackPoint ─────────────────────────────────

test("createRollbackPoint creates a snapshot or returns null on failure", async () => {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-repair-rollback-"));
    process.env.HOME = tempHome;

    try {
        const snapshot = await createRollbackPoint();
        // Either creates a snapshot (with id) or returns null if it can't
        if (snapshot) {
            assert.ok(snapshot.id);
            assert.ok(snapshot.archivePath);
        }
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
});

// ─── Integration: saveRepairRecord + listHistory + delete cycle ───────

test("saveRepairRecord + listHistory + deleteRepairRecord full cycle", () => {
    withTempHome(() => {
        const record = {
            id: "cycle-test",
            createdAt: new Date().toISOString(),
            issues: [{ id: "i1", severity: "WARNING", description: "test" }],
            fixed: 1,
            failed: 0,
            skipped: 0,
            durationMs: 3000,
            machine: { hostname: "test" }
        };
        saveRepairRecord(record);

        const history = listHistory();
        assert.equal(history.length, 1);
        assert.equal(history[0].id, "cycle-test");

        deleteRepairRecord("cycle-test");
        const afterDelete = listHistory();
        assert.equal(afterDelete.length, 0);
    });
});

// ─── Phase 2: Repair Categories ───────────────────────────────────────

test("REPAIR_CATEGORIES defines all expected categories", () => {
    assert.ok(REPAIR_CATEGORIES.COMPATIBILITY);
    assert.ok(REPAIR_CATEGORIES.PATH);
    assert.ok(REPAIR_CATEGORIES.GIT);
    assert.ok(REPAIR_CATEGORIES.DOCKER);
    assert.ok(REPAIR_CATEGORIES.SSH);
    assert.ok(REPAIR_CATEGORIES.CACHE);
    assert.ok(REPAIR_CATEGORIES.HOMEBREW);
    assert.ok(REPAIR_CATEGORIES.WORKSPACE);
    assert.ok(REPAIR_CATEGORIES.PLUGINS);
});

test("CATEGORY_LABELS provides display names for all categories", () => {
    for (const [, value] of Object.entries(REPAIR_CATEGORIES)) {
        assert.ok(CATEGORY_LABELS[value], `Label missing for category: ${value}`);
    }
});

// ─── Phase 3: Risk Levels & Action Types ──────────────────────────────

test("RISK_LEVELS defines none, low, medium, high", () => {
    assert.equal(RISK_LEVELS.NONE, "none");
    assert.equal(RISK_LEVELS.LOW, "low");
    assert.equal(RISK_LEVELS.MEDIUM, "medium");
    assert.equal(RISK_LEVELS.HIGH, "high");
});

test("RISK_LABELS provides display names for all risk levels", () => {
    for (const [, value] of Object.entries(RISK_LEVELS)) {
        assert.ok(RISK_LABELS[value], `Label missing for risk: ${value}`);
    }
});

test("ACTION_TYPES defines all action types", () => {
    assert.ok(ACTION_TYPES.SHELL);
    assert.ok(ACTION_TYPES.INSTALL);
    assert.ok(ACTION_TYPES.UNINSTALL);
    assert.ok(ACTION_TYPES.COMPATIBILITY);
    assert.ok(ACTION_TYPES.COMPONENT_REPAIR);
    assert.ok(ACTION_TYPES.MANUAL);
});

// ─── Phase 3: Issue metadata ──────────────────────────────────────────

test("planRepairs includes risk level in plan output", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix", estimatedTime: "1 min", dependencies: [], risk: "low", action: { type: "manual" } },
        { id: "2", severity: "CRITICAL", category: "test", subsystem: "test", description: "b", fix: "fix", estimatedTime: "1 min", dependencies: [], risk: "high", action: { type: "manual" } }
    ];
    const plan = planRepairs(issues);
    assert.equal(plan.riskLevel, "high");
    assert.equal(plan.riskLabel, "High");
});

test("planRepairs includes categoriesAffected in plan output", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "a", fix: "fix", estimatedTime: "1 min", dependencies: [], action: { type: "manual" } },
        { id: "2", severity: "WARNING", category: "docker", categoryLabel: "Docker", subsystem: "docker", description: "b", fix: "fix", estimatedTime: "1 min", dependencies: [], action: { type: "manual" } }
    ];
    const plan = planRepairs(issues);
    assert.ok(plan.categoriesAffected.includes("Git"));
    assert.ok(plan.categoriesAffected.includes("Docker"));
});

test("planRepairs includes packagesAffected when install actions present", () => {
    const issues = [
        { id: "1", severity: "WARNING", category: "test", subsystem: "test", description: "a", fix: "fix", estimatedTime: "1 min", dependencies: [], action: { type: "install", package: "node" } },
        { id: "2", severity: "WARNING", category: "test", subsystem: "test", description: "b", fix: "fix", estimatedTime: "1 min", dependencies: [], action: { type: "install", package: "python" } }
    ];
    const plan = planRepairs(issues);
    assert.ok(plan.packagesAffected.includes("node"));
    assert.ok(plan.packagesAffected.includes("python"));
});

// ─── Phase 5: Dry Run ─────────────────────────────────────────────────

test("dryRunPlan returns structured preview without executing", () => {
    const plan = planRepairs([
        { id: "1", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "git name not set", fix: "git config --global user.name 'Test'", estimatedTime: "30 sec", dependencies: [], risk: "low", riskLabel: "Low", title: "Git: name not set", action: { type: "shell", command: "git config --global user.name 'Test'", filesAffected: ["~/.gitconfig"] } }
    ]);
    const preview = dryRunPlan(plan);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.totalRepairs, 1);
    assert.equal(preview.preview[0].actionType, "shell");
    assert.ok(preview.preview[0].description.includes("git config"));
    assert.equal(preview.preview[0].risk, "Low");
});

test("dryRunPlan handles manual actions", () => {
    const plan = planRepairs([
        { id: "1", severity: "WARNING", category: "ssh", categoryLabel: "SSH", subsystem: "ssh", description: "no keys", fix: "ssh-keygen", estimatedTime: "2 min", dependencies: [], risk: "low", riskLabel: "Low", title: "SSH: no keys", action: { type: "manual", suggestion: "ssh-keygen" } }
    ]);
    const preview = dryRunPlan(plan);
    assert.equal(preview.preview[0].actionType, "manual");
    assert.ok(preview.preview[0].description.includes("ssh-keygen"));
});

test("dryRunPlan includes filesAffected and packagesAffected", () => {
    const plan = {
        totalRepairs: 1, totalInfo: 0, estimatedTime: "1 min", requiresRestart: false,
        riskLabel: "Low", categoriesAffected: ["Git"], filesAffected: ["~/.gitconfig"], packagesAffected: [],
        issues: [
            { id: "1", title: "Git name", severity: "WARNING", categoryLabel: "Git", riskLabel: "Low", estimatedTime: "30 sec", requiresRestart: false, rollbackAvailable: true, action: { type: "shell", command: "git config --global user.name 'Test'", filesAffected: ["~/.gitconfig"] } }
        ],
        informational: []
    };
    const preview = dryRunPlan(plan);
    assert.ok(preview.filesAffected.includes("~/.gitconfig"));
    assert.equal(preview.packagesAffected.length, 0);
});

// ─── Phase 12: Repair Quality Score ───────────────────────────────────

test("computeQualityScore returns 100 when no repairs needed", () => {
    const execution = { results: [], fixed: 0, failed: 0, skipped: 0, rollbackSnapshot: null };
    const score = computeQualityScore(execution, null);
    assert.equal(score.score, 100);
    assert.equal(score.grade, "A");
});

test("computeQualityScore rewards success and safety", () => {
    const execution = {
        results: [{ ok: true }, { ok: true }, { ok: true }],
        fixed: 3, failed: 0, skipped: 0, rollbackSnapshot: "snap-123"
    };
    const verification = { health: { score: 95 } };
    const score = computeQualityScore(execution, verification);
    assert.ok(score.score >= 90);
    assert.equal(score.successRate, 100);
});

test("computeQualityScore penalizes skipped repairs", () => {
    const execution = {
        results: [{ ok: true }, { ok: false, skipped: true }, { ok: true }],
        fixed: 2, failed: 0, skipped: 1, rollbackSnapshot: null
    };
    const verification = { health: { score: 50 } };
    const score = computeQualityScore(execution, verification);
    assert.ok(score.score < 100);
    assert.ok(score.skipped === 1);
});

// ─── Phase 4: Safety Layer ────────────────────────────────────────────

test("validatePrerequisites returns ok for manual actions", async () => {
    const result = await validatePrerequisites({ type: ACTION_TYPES.MANUAL });
    assert.ok(result.ok);
    assert.equal(result.checks.length, 0);
});

test("validatePrerequisites detects unknown package for install", async () => {
    const result = await validatePrerequisites({ type: ACTION_TYPES.INSTALL, package: "nonexistent-pkg-xyz" });
    assert.ok(!result.ok);
    assert.ok(result.checks.some((c) => c.check === "registry"));
});

// Phase 3 cross-platform audit regression: validatePrerequisites used to
// read pkg.install.method directly ("brew-formula" for almost every
// package, including bat) to decide whether Homebrew is required, instead
// of resolving through the same platformInstall lookup install() itself
// uses - so it would have required Homebrew on Linux even for a package
// like bat whose real platformInstall.linux step is a plain apt install
// with no Homebrew dependency at all. commandExists("brew") isn't
// injectable here (this dev machine has brew installed either way, which
// would mask the bug at the validatePrerequisites boundary), so this
// verifies the real registry fact the fix depends on: bat's *resolved*
// Linux step is apt, not the brew-formula its top-level `install` field
// alone would suggest.
test("bat's platformInstall resolves to apt on Linux, not its top-level brew-formula install (the fact validatePrerequisites' fix depends on)", async () => {
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = getPackage("bat");
        assert.equal(pkg.install.method, "brew-formula", "sanity: bat's top-level install is still brew-formula");
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "apt");
    } finally {
        resetPlatformForTesting();
    }
});

// ─── Phase 8: Per-repair rollback ─────────────────────────────────────

test("rollbackRepairResult returns failure when no file backups exist", () => {
    const result = rollbackRepairResult({ ok: true });
    assert.ok(!result.ok);
    assert.ok(result.error);
});

test("rollbackRepairResult returns failure for null result", () => {
    const result = rollbackRepairResult(null);
    assert.ok(!result.ok);
});

// ─── Phase 9: Enhanced history metadata ───────────────────────────────

test("listHistory includes enhanced metadata (platform, risk, quality)", () => {
    withTempHome(() => {
        saveRepairRecord({
            id: "meta-test",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 0, failed: 0, skipped: 0,
            durationMs: 1000,
            machine: { hostname: "test", platform: "macos", user: "tester" },
            plan: { riskLevel: "low", categoriesAffected: ["Git"] },
            qualityScore: { score: 85, grade: "B", verdict: "Good" }
        });
        const history = listHistory();
        assert.equal(history.length, 1);
        assert.equal(history[0].platform, "macos");
        assert.equal(history[0].user, "tester");
        assert.equal(history[0].riskLevel, "low");
        assert.ok(history[0].categoriesAffected.includes("Git"));
        assert.equal(history[0].qualityScore.score, 85);
    });
});

// ─── Phase 3 fix: estimatedTime parsing ───────────────────────────────

test("planRepairs parses 'N sec' and 'N min' time formats correctly", () => {
    const plan = planRepairs([
        { id: "1", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "a", fix: "git config", estimatedTime: "30 sec", risk: "low", riskLabel: "Low", dependencies: [], action: { type: "shell", command: "git config" } },
        { id: "2", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "b", fix: "git config", estimatedTime: "2 min", risk: "low", riskLabel: "Low", dependencies: [], action: { type: "shell", command: "git config" } }
    ]);
    // 30 sec + 120 sec = 150 sec → ceil(150/60) = 3 min
    assert.equal(plan.estimatedTime, "3 min");
    assert.equal(plan.estimatedTimeSeconds, 150);
});

test("planRepairs handles sub-minute total time", () => {
    const plan = planRepairs([
        { id: "1", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "a", fix: "git config", estimatedTime: "15 sec", risk: "low", riskLabel: "Low", dependencies: [], action: { type: "shell", command: "git config" } }
    ]);
    assert.equal(plan.estimatedTime, "15 sec");
    assert.equal(plan.estimatedTimeSeconds, 15);
});

// ─── Phase 4 fix: rollback validation ─────────────────────────────────

test("planRepairs tracks rollbackUnavailableCount and rollbackUnavailableIssues", () => {
    const plan = planRepairs([
        { id: "1", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "a", fix: "git config", estimatedTime: "30 sec", risk: "low", riskLabel: "Low", dependencies: [], rollbackAvailable: true, action: { type: "shell", command: "git config" } },
        { id: "2", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "b", fix: "manual", estimatedTime: "5 min", risk: "medium", riskLabel: "Medium", dependencies: [], rollbackAvailable: false, action: { type: "manual", suggestion: "manual" } }
    ]);
    assert.equal(plan.rollbackAvailable, false);
    assert.equal(plan.rollbackUnavailableCount, 1);
    assert.deepEqual(plan.rollbackUnavailableIssues, ["2"]);
});

// ─── Phase 10: Repair Intelligence ─────────────────────────────────────

test("explainRepair produces structured Problem/Impact/Fix/Risk/Time output", () => {
    const issue = {
        description: "Git user.name is not set",
        impact: "Commits will fail",
        fix: "git config --global user.name 'Name'",
        riskLabel: "Low",
        estimatedTime: "30 sec",
        rollbackAvailable: true,
        requiresRestart: false,
        action: { type: "shell", command: "git config --global user.name 'Name'", filesAffected: ["~/.gitconfig"] }
    };
    const text = explainRepair(issue);
    assert.ok(text.includes("Problem"));
    assert.ok(text.includes("Git user.name is not set"));
    assert.ok(text.includes("Impact"));
    assert.ok(text.includes("Commits will fail"));
    assert.ok(text.includes("Fix"));
    assert.ok(text.includes("git config"));
    assert.ok(text.includes("Risk"));
    assert.ok(text.includes("Low"));
    assert.ok(text.includes("Estimated time"));
    assert.ok(text.includes("30 sec"));
    assert.ok(text.includes("Rollback"));
    assert.ok(text.includes("Available"));
    assert.ok(text.includes("Command"));
    assert.ok(text.includes("Files affected"));
    assert.ok(text.includes("~/.gitconfig"));
});

test("explainRepair shows 'Not available' when rollback not supported", () => {
    const text = explainRepair({
        description: "test", impact: "test", fix: "manual",
        riskLabel: "Medium", estimatedTime: "5 min",
        rollbackAvailable: false, action: { type: "manual" }
    });
    assert.ok(text.includes("Not available"));
});

test("explainPlan produces full plan explanation with all repairs", () => {
    const plan = planRepairs([
        { id: "1", severity: "WARNING", category: "git", categoryLabel: "Git", subsystem: "git", description: "Git name not set", impact: "Commits fail", fix: "git config", estimatedTime: "30 sec", risk: "low", riskLabel: "Low", dependencies: [], rollbackAvailable: true, action: { type: "shell", command: "git config" } },
        { id: "2", severity: "WARNING", category: "docker", categoryLabel: "Docker", subsystem: "docker", description: "Docker not running", impact: "Can't build", fix: "open -a Docker", estimatedTime: "30 sec", risk: "none", riskLabel: "None", dependencies: [], rollbackAvailable: true, action: { type: "shell", command: "open -a Docker" } }
    ]);
    const text = explainPlan(plan);
    assert.ok(text.includes("Repair Plan Explanation"));
    assert.ok(text.includes("Total repairs: 2"));
    assert.ok(text.includes("Repair 1 of 2"));
    assert.ok(text.includes("Repair 2 of 2"));
    assert.ok(text.includes("Git name not set"));
    assert.ok(text.includes("Docker not running"));
    assert.ok(text.includes("Risk level:"));
});

// ─── Phase 8: Full rollback system ────────────────────────────────────

test("listRollbackPoints returns records with rollback potential", () => {
    withTempHome(() => {
        saveRepairRecord({
            id: "rb-1",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 3, failed: 0, skipped: 0,
            durationMs: 5000,
            machine: { hostname: "test", platform: "macos", user: "tester" },
            plan: { riskLevel: "low", categoriesAffected: ["Git"] },
            rollbackSnapshotId: "snap-123",
            qualityScore: { score: 90, grade: "A", verdict: "Excellent" }
        });
        saveRepairRecord({
            id: "rb-2",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 0, failed: 0, skipped: 0,
            durationMs: 100,
            machine: { hostname: "test", platform: "macos", user: "tester" },
            plan: { riskLevel: "none", categoriesAffected: [] }
        });
        const points = listRollbackPoints();
        // rb-1 has rollbackSnapshotId and fixed > 0, rb-2 has fixed=0 and no snapshot
        assert.ok(points.some((p) => p.id === "rb-1"));
    });
});

test("previewRollback returns structured preview without executing", () => {
    withTempHome(() => {
        saveRepairRecord({
            id: "prev-test",
            createdAt: new Date().toISOString(),
            issues: [],
            fixed: 1, failed: 0, skipped: 0,
            durationMs: 1000,
            machine: { hostname: "test", platform: "macos", user: "tester" },
            plan: { riskLevel: "low", categoriesAffected: [] },
            rollbackSnapshotId: "snap-456",
            repairResults: [
                { ok: true, issue: { title: "Git config" }, fileBackups: { "/fake/path": "/fake/backup" } }
            ]
        });
        const preview = previewRollback("prev-test");
        assert.equal(preview.repairId, "prev-test");
        assert.equal(preview.hasSnapshot, true);
        assert.equal(preview.rollbackSnapshotId, "snap-456");
        assert.equal(preview.repairsReversible, 1);
        assert.equal(preview.fileBackups.length, 1);
        assert.equal(preview.fileBackups[0].originalPath, "/fake/path");
        assert.equal(preview.fileBackups[0].backupExists, false);
    });
});

// ─── Phase 9: History filtering and searching ─────────────────────────

test("listHistory filters by risk level", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "r1", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        saveRepairRecord({ id: "r2", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "high", categoriesAffected: [] } });
        const lowOnly = listHistory({ filter: { risk: "low" } });
        assert.equal(lowOnly.length, 1);
        assert.equal(lowOnly[0].id, "r1");
    });
});

test("listHistory filters by category", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "c1", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: ["Git", "Docker"] } });
        saveRepairRecord({ id: "c2", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: ["SSH"] } });
        const gitOnly = listHistory({ filter: { category: "Git" } });
        assert.equal(gitOnly.length, 1);
        assert.equal(gitOnly[0].id, "c1");
    });
});

test("listHistory filters by status", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "s1", createdAt: new Date().toISOString(), issues: [], fixed: 5, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        saveRepairRecord({ id: "s2", createdAt: new Date().toISOString(), issues: [], fixed: 0, failed: 3, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        saveRepairRecord({ id: "s3", createdAt: new Date().toISOString(), issues: [], fixed: 2, failed: 1, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        const success = listHistory({ filter: { status: "success" } });
        assert.equal(success.length, 1);
        assert.equal(success[0].id, "s1");
        const failed = listHistory({ filter: { status: "failed" } });
        assert.equal(failed.length, 2); // s2 and s3 both have failures
        const partial = listHistory({ filter: { status: "partial" } });
        assert.equal(partial.length, 1);
        assert.equal(partial[0].id, "s3");
    });
});

test("listHistory searches across id, machine, and categories", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "search-1", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: { hostname: "macbook-pro" }, plan: { riskLevel: "low", categoriesAffected: ["Git"] } });
        saveRepairRecord({ id: "search-2", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: { hostname: "linux-box" }, plan: { riskLevel: "low", categoriesAffected: ["Docker"] } });
        const results = listHistory({ search: "macbook" });
        assert.equal(results.length, 1);
        assert.equal(results[0].id, "search-1");
        const gitResults = listHistory({ search: "git" });
        assert.equal(gitResults.length, 1);
        assert.equal(gitResults[0].id, "search-1");
    });
});

test("listHistory supports limit", () => {
    withTempHome(() => {
        for (let i = 0; i < 5; i++) {
            saveRepairRecord({ id: `lim-${i}`, createdAt: new Date(Date.now() + i).toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        }
        const limited = listHistory({ limit: 2 });
        assert.equal(limited.length, 2);
    });
});

test("listHistory supports sorting by fixed count", () => {
    withTempHome(() => {
        saveRepairRecord({ id: "sort-1", createdAt: new Date().toISOString(), issues: [], fixed: 1, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        saveRepairRecord({ id: "sort-2", createdAt: new Date().toISOString(), issues: [], fixed: 5, failed: 0, skipped: 0, durationMs: 100, machine: {}, plan: { riskLevel: "low", categoriesAffected: [] } });
        const sorted = listHistory({ sortBy: "fixed", sortOrder: "desc" });
        assert.equal(sorted[0].id, "sort-2");
        assert.equal(sorted[1].id, "sort-1");
    });
});
