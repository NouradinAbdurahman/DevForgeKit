import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    PACKAGE_INTEL_VERSION,
    PACKAGE_INTEL_DIR,
    formatBytes,
    buildGraph,
    renderTree,
    detectOrphans,
    compareAnalyses,
    exportAnalysis,
    saveAnalysis,
    listHistory,
    loadAnalysis,
    clearCache,
    searchPackages,
    applyFilter,
    packageInfo,
    analyzePackages,
    getInstalledPackageNames
} from "../src/core/packageIntel.js";
import { loadPackages } from "../src/core/registry.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.devforgekit (same pattern as all other test files).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-pkg-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Constants ────────────────────────────────────────────────────────

test("PACKAGE_INTEL_VERSION is 1", () => {
    assert.equal(PACKAGE_INTEL_VERSION, 1);
});

test("PACKAGE_INTEL_DIR is 'package-intel'", () => {
    assert.equal(PACKAGE_INTEL_DIR, "package-intel");
});

// ─── formatBytes ──────────────────────────────────────────────────────

test("formatBytes formats bytes correctly", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(1024), "1 KB");
    assert.equal(formatBytes(1024 * 1024), "1.0 MB");
    assert.equal(formatBytes(1024 * 1024 * 1024), "1.00 GB");
});

// ─── buildGraph ───────────────────────────────────────────────────────

test("buildGraph returns nodes, edges, and depth for a simple dependency", () => {
    const packages = loadPackages();
    const flutter = packages.find((p) => p.name === "flutter");
    assert.ok(flutter, "flutter should exist in registry");

    const graph = buildGraph(["flutter"], { packages });

    assert.ok(graph.nodes.some((n) => n.name === "flutter"));
    assert.ok(graph.nodes.some((n) => n.name === "dart"));
    assert.ok(graph.edges.some((e) => e.from === "flutter" && e.to === "dart"));

    // Flutter should have depth > 0 since it depends on dart
    const flutterNode = graph.nodes.find((n) => n.name === "flutter");
    const dartNode = graph.nodes.find((n) => n.name === "dart");
    assert.ok(flutterNode.depth > dartNode.depth, "flutter should have greater depth than dart");
});

test("buildGraph detects missing dependencies", () => {
    const packages = [{ name: "test-pkg", dependencies: ["nonexistent-dep"] }];
    const graph = buildGraph(["test-pkg"], { packages });

    assert.ok(graph.missing.includes("nonexistent-dep"));
});

test("buildGraph returns empty for no names", () => {
    const graph = buildGraph([]);
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.edges.length, 0);
});

// ─── renderTree ───────────────────────────────────────────────────────

test("renderTree produces a tree structure for flutter", () => {
    const packages = loadPackages();
    const tree = renderTree(["flutter"], { packages });

    assert.ok(tree.includes("flutter"));
    assert.ok(tree.includes("dart"));
    // Should have tree characters
    assert.ok(tree.includes("└──") || tree.includes("├──"));
});

test("renderTree handles missing package gracefully", () => {
    const tree = renderTree(["nonexistent-pkg"]);
    assert.ok(tree.includes("nonexistent-pkg"));
});

test("renderTree handles cycle protection", () => {
    const packages = [
        { name: "a", dependencies: ["b"] },
        { name: "b", dependencies: ["a"] }
    ];
    const tree = renderTree(["a"], { packages });
    assert.ok(tree.includes("a"));
    assert.ok(tree.includes("b"));
    assert.ok(tree.includes("cycle"));
});

// ─── detectOrphans ────────────────────────────────────────────────────

test("detectOrphans identifies packages with no usage or dependents", () => {
    const profiles = [
        {
            name: "used-pkg",
            reverseDependencies: ["other-pkg"],
            workspaceUsage: [],
            recipeUsage: [],
            profileUsage: [],
            collectionUsage: [],
            pluginUsage: [],
            sizeBytes: 1024,
            healthStatus: "healthy",
            lastUsed: null
        },
        {
            name: "orphan-pkg",
            reverseDependencies: [],
            workspaceUsage: [],
            recipeUsage: [],
            profileUsage: [],
            collectionUsage: [],
            pluginUsage: [],
            sizeBytes: 2048,
            healthStatus: "healthy",
            lastUsed: null
        }
    ];

    const orphans = detectOrphans(profiles);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].name, "orphan-pkg");
    assert.equal(orphans[0].safeToRemove, true);
});

test("detectOrphans returns empty for all-used packages", () => {
    const profiles = [
        {
            name: "used-pkg",
            reverseDependencies: ["other"],
            workspaceUsage: [],
            recipeUsage: [],
            profileUsage: [],
            collectionUsage: [],
            pluginUsage: [],
            sizeBytes: 1024,
            healthStatus: "healthy"
        }
    ];

    const orphans = detectOrphans(profiles);
    assert.equal(orphans.length, 0);
});

test("detectOrphans marks broken packages as not safe to remove", () => {
    const profiles = [
        {
            name: "broken-orphan",
            reverseDependencies: [],
            workspaceUsage: [],
            recipeUsage: [],
            profileUsage: [],
            collectionUsage: [],
            pluginUsage: [],
            sizeBytes: 1024,
            healthStatus: "broken"
        }
    ];

    const orphans = detectOrphans(profiles);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].safeToRemove, false);
});

test("detectOrphans respects workspace usage", () => {
    const profiles = [
        {
            name: "ws-used",
            reverseDependencies: [],
            workspaceUsage: ["my-workspace"],
            recipeUsage: [],
            profileUsage: [],
            collectionUsage: [],
            pluginUsage: [],
            sizeBytes: 1024,
            healthStatus: "healthy"
        }
    ];

    const orphans = detectOrphans(profiles);
    assert.equal(orphans.length, 0);
});

test("detectOrphans respects recipe usage", () => {
    const profiles = [
        {
            name: "recipe-used",
            reverseDependencies: [],
            workspaceUsage: [],
            recipeUsage: ["my-recipe"],
            profileUsage: [],
            collectionUsage: [],
            pluginUsage: [],
            sizeBytes: 1024,
            healthStatus: "healthy"
        }
    ];

    const orphans = detectOrphans(profiles);
    assert.equal(orphans.length, 0);
});

// ─── searchPackages ───────────────────────────────────────────────────

test("searchPackages finds by name", () => {
    const analysis = {
        profiles: [
            { name: "flutter", description: "UI toolkit", category: "mobile", tags: ["mobile"] },
            { name: "node", description: "JS runtime", category: "languages", tags: ["javascript"] }
        ]
    };

    const results = searchPackages(analysis, "flutter");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "flutter");
});

test("searchPackages finds by description", () => {
    const analysis = {
        profiles: [
            { name: "flutter", description: "cross-platform UI toolkit", category: "mobile", tags: [] }
        ]
    };

    const results = searchPackages(analysis, "toolkit");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "flutter");
});

test("searchPackages finds by tag", () => {
    const analysis = {
        profiles: [
            { name: "node", description: "JS runtime", category: "languages", tags: ["javascript", "runtime"] }
        ]
    };

    const results = searchPackages(analysis, "javascript");
    assert.equal(results.length, 1);
    assert.equal(results[0].name, "node");
});

test("searchPackages returns empty for no matches", () => {
    const analysis = {
        profiles: [
            { name: "node", description: "JS runtime", category: "languages", tags: [] }
        ]
    };

    const results = searchPackages(analysis, "nonexistent");
    assert.equal(results.length, 0);
});

test("searchPackages with empty query returns all", () => {
    const analysis = {
        profiles: [
            { name: "a", description: "", category: "", tags: [] },
            { name: "b", description: "", category: "", tags: [] }
        ]
    };

    const results = searchPackages(analysis, "");
    assert.equal(results.length, 2);
});

// ─── applyFilter ──────────────────────────────────────────────────────

test("applyFilter 'outdated' returns only outdated packages", () => {
    const profiles = [
        { name: "a", isOutdated: true },
        { name: "b", isOutdated: false }
    ];
    const result = applyFilter(profiles, "outdated");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "a");
});

test("applyFilter 'unused' returns only orphan packages", () => {
    const profiles = [
        { name: "a", isOrphan: true },
        { name: "b", isOrphan: false }
    ];
    const result = applyFilter(profiles, "unused");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "a");
});

test("applyFilter 'duplicated' returns only duplicate packages", () => {
    const profiles = [
        { name: "a", isDuplicate: true },
        { name: "b", isDuplicate: false }
    ];
    const result = applyFilter(profiles, "duplicated");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "a");
});

test("applyFilter 'broken' returns only broken packages", () => {
    const profiles = [
        { name: "a", healthStatus: "broken" },
        { name: "b", healthStatus: "healthy" }
    ];
    const result = applyFilter(profiles, "broken");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "a");
});

test("applyFilter 'large' returns packages >500MB sorted by size", () => {
    const profiles = [
        { name: "a", sizeBytes: 100 * 1024 * 1024 },
        { name: "b", sizeBytes: 600 * 1024 * 1024 },
        { name: "c", sizeBytes: 1024 * 1024 * 1024 }
    ];
    const result = applyFilter(profiles, "large");
    assert.equal(result.length, 2);
    assert.equal(result[0].name, "c"); // largest first
    assert.equal(result[1].name, "b");
});

test("applyFilter 'most-used' sorts by execution count descending", () => {
    const profiles = [
        { name: "a", timesExecuted: 5 },
        { name: "b", timesExecuted: 100 },
        { name: "c", timesExecuted: 50 }
    ];
    const result = applyFilter(profiles, "most-used");
    assert.equal(result[0].name, "b");
    assert.equal(result[1].name, "c");
    assert.equal(result[2].name, "a");
});

test("applyFilter with unknown filter returns all", () => {
    const profiles = [{ name: "a" }, { name: "b" }];
    const result = applyFilter(profiles, "nonexistent");
    assert.equal(result.length, 2);
});

// ─── compareAnalyses ──────────────────────────────────────────────────

test("compareAnalyses identifies added, removed, and updated packages", () => {
    const oldAnalysis = {
        profiles: [
            { name: "node", version: "20.0.0", sizeBytes: 50000000 },
            { name: "python", version: "3.12.0", sizeBytes: 80000000 },
            { name: "ruby", version: "3.3.0", sizeBytes: 30000000 }
        ]
    };
    const newAnalysis = {
        profiles: [
            { name: "node", version: "20.1.0", sizeBytes: 51000000 },
            { name: "python", version: "3.12.0", sizeBytes: 80000000 },
            { name: "go", version: "1.22.0", sizeBytes: 60000000 }
        ]
    };

    const comparison = compareAnalyses(oldAnalysis, newAnalysis);

    assert.equal(comparison.summary.addedCount, 1);
    assert.equal(comparison.summary.removedCount, 1);
    assert.equal(comparison.summary.updatedCount, 1);
    assert.equal(comparison.summary.unchangedCount, 1);

    assert.equal(comparison.added[0].name, "go");
    assert.equal(comparison.removed[0].name, "ruby");
    assert.equal(comparison.updated[0].name, "node");
    assert.equal(comparison.updated[0].oldVersion, "20.0.0");
    assert.equal(comparison.updated[0].newVersion, "20.1.0");
});

test("compareAnalyses with identical analyses shows all unchanged", () => {
    const analysis = {
        profiles: [
            { name: "node", version: "20.0.0", sizeBytes: 50000000 }
        ]
    };

    const comparison = compareAnalyses(analysis, analysis);
    assert.equal(comparison.summary.addedCount, 0);
    assert.equal(comparison.summary.removedCount, 0);
    assert.equal(comparison.summary.updatedCount, 0);
    assert.equal(comparison.summary.unchangedCount, 1);
});

// ─── exportAnalysis ───────────────────────────────────────────────────

test("exportAnalysis produces valid JSON", () => {
    const analysis = {
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.5",
        machine: { hostname: "test" },
        summary: { total: 1, totalSizeBytes: 1024, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
        profiles: [{ name: "test", version: "1.0", category: "test", sizeBytes: 1024, healthStatus: "healthy" }],
        orphans: [],
        duplicates: [],
        outdated: []
    };
    const json = exportAnalysis(analysis, "json");
    const parsed = JSON.parse(json);
    assert.equal(parsed.summary.total, 1);
});

test("exportAnalysis produces valid Markdown", () => {
    const analysis = {
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.5",
        machine: { hostname: "test" },
        summary: { total: 2, totalSizeBytes: 2048, orphanCount: 1, duplicateCount: 0, outdatedCount: 0, healthyCount: 1, brokenCount: 1 },
        profiles: [
            { name: "pkg-a", version: "1.0", category: "test", sizeBytes: 1024, healthStatus: "healthy", isOrphan: false, isDuplicate: false, isOutdated: false },
            { name: "pkg-b", version: "2.0", category: "test", sizeBytes: 1024, healthStatus: "broken", isOrphan: true, isDuplicate: false, isOutdated: false }
        ],
        orphans: [{ name: "pkg-b", reason: "no usage", sizeBytes: 1024, safeToRemove: false }],
        duplicates: [],
        outdated: []
    };
    const md = exportAnalysis(analysis, "markdown");
    assert.ok(md.includes("# Package Intelligence Report"));
    assert.ok(md.includes("## Summary"));
    assert.ok(md.includes("## Package Profiles"));
    assert.ok(md.includes("## Orphan Packages"));
});

test("exportAnalysis produces valid HTML", () => {
    const analysis = {
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.5",
        machine: { hostname: "test" },
        summary: { total: 1, totalSizeBytes: 1024, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
        profiles: [{ name: "test", version: "1.0", category: "test", sizeBytes: 1024, healthStatus: "healthy" }],
        orphans: [],
        duplicates: [],
        outdated: []
    };
    const html = exportAnalysis(analysis, "html");
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("Package Intelligence Report"));
});

test("exportAnalysis produces valid CSV", () => {
    const analysis = {
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.5",
        machine: { hostname: "test" },
        summary: { total: 1, totalSizeBytes: 1024, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
        profiles: [
            { name: "test", version: "1.0", category: "lang", sizeBytes: 1024, healthStatus: "healthy", installMethod: "brew", isOrphan: false, isDuplicate: false, isOutdated: false, dependencies: ["dep1"], reverseDependencies: [] }
        ],
        orphans: [],
        duplicates: [],
        outdated: []
    };
    const csv = exportAnalysis(analysis, "csv");
    const lines = csv.trim().split("\n");
    assert.equal(lines[0], "name,version,category,size_bytes,health_status,install_method,orphan,duplicate,outdated,dependencies,reverse_dependencies");
    assert.ok(lines[1].startsWith("test,1.0,lang,"));
});

test("exportAnalysis produces valid DOT graph", () => {
    const analysis = {
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.5",
        machine: { hostname: "test" },
        summary: { total: 1, totalSizeBytes: 0, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
        profiles: [
            { name: "flutter", dependencies: ["dart"] },
            { name: "dart", dependencies: [] }
        ],
        orphans: [],
        duplicates: [],
        outdated: []
    };
    const dot = exportAnalysis(analysis, "dot");
    assert.ok(dot.includes("digraph packages {"));
    assert.ok(dot.includes('"flutter" -> "dart";'));
    assert.ok(dot.includes("}"));
});

test("exportAnalysis produces valid Mermaid graph", () => {
    const analysis = {
        createdAt: "2025-01-01T00:00:00.000Z",
        devforgekitVersion: "1.3.5",
        machine: { hostname: "test" },
        summary: { total: 1, totalSizeBytes: 0, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
        profiles: [
            { name: "flutter", dependencies: ["dart"] },
            { name: "dart", dependencies: [] }
        ],
        orphans: [],
        duplicates: [],
        outdated: []
    };
    const mermaid = exportAnalysis(analysis, "mermaid");
    assert.ok(mermaid.includes("graph LR"));
    assert.ok(mermaid.includes("flutter --> dart"));
});

test("exportAnalysis throws for unknown format", () => {
    const analysis = { profiles: [], summary: {}, orphans: [], duplicates: [], outdated: [] };
    assert.throws(
        () => exportAnalysis(analysis, "xml"),
        /Unknown export format/
    );
});

// ─── saveAnalysis / listHistory / loadAnalysis ───────────────────────

test("saveAnalysis writes a JSON file to ~/.devforgekit/package-intel/", () => {
    withTempHome(() => {
        const analysis = {
            createdAt: "2025-01-01T00-00-00-000Z",
            devforgekitVersion: "1.3.5",
            machine: { hostname: "test" },
            summary: { total: 0, totalSizeBytes: 0, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
            profiles: [],
            orphans: [],
            duplicates: [],
            outdated: []
        };
        const filePath = saveAnalysis(analysis);
        assert.ok(existsSync(filePath));
        assert.ok(filePath.endsWith(".json"));
    });
});

test("listHistory returns empty when no directory exists", () => {
    withTempHome(() => {
        const history = listHistory();
        assert.deepEqual(history, []);
    });
});

test("listHistory returns saved analyses sorted by date", () => {
    withTempHome(() => {
        saveAnalysis({
            createdAt: "2025-01-01T00-00-00-000Z",
            summary: { total: 1, totalSizeBytes: 100, orphanCount: 0, duplicateCount: 0, outdatedCount: 0 },
            profiles: [], orphans: [], duplicates: [], outdated: []
        });
        saveAnalysis({
            createdAt: "2025-06-01T00-00-00-000Z",
            summary: { total: 2, totalSizeBytes: 200, orphanCount: 1, duplicateCount: 0, outdatedCount: 0 },
            profiles: [], orphans: [], duplicates: [], outdated: []
        });

        const history = listHistory();
        assert.equal(history.length, 2);
        assert.equal(history[0].createdAt, "2025-06-01T00-00-00-000Z");
        assert.equal(history[1].createdAt, "2025-01-01T00-00-00-000Z");
    });
});

test("loadAnalysis reads a saved analysis file", () => {
    withTempHome(() => {
        const analysis = {
            createdAt: "2025-01-01T00-00-00-000Z",
            summary: { total: 5, totalSizeBytes: 1000, orphanCount: 1, duplicateCount: 0, outdatedCount: 0 },
            profiles: [{ name: "test" }],
            orphans: [],
            duplicates: [],
            outdated: []
        };
        const filePath = saveAnalysis(analysis);
        const loaded = loadAnalysis(filePath);
        assert.equal(loaded.summary.total, 5);
        assert.equal(loaded.profiles.length, 1);
    });
});

test("loadAnalysis throws for non-existent file", () => {
    withTempHome(() => {
        assert.throws(
            () => loadAnalysis("/nonexistent/file.json"),
            /not found/
        );
    });
});

// ─── clearCache ───────────────────────────────────────────────────────

test("clearCache returns false when no cache exists", () => {
    withTempHome(() => {
        const result = clearCache();
        assert.equal(result, false);
    });
});

// ─── packageInfo ──────────────────────────────────────────────────────

test("packageInfo returns registry data for a known package", () => {
    const info = packageInfo("flutter");
    assert.ok(info.registry);
    assert.equal(info.registry.name, "flutter");
});

test("packageInfo includes profile when analysis is provided", () => {
    const analysis = {
        profiles: [{ name: "flutter", version: "3.0.0", healthStatus: "healthy" }]
    };
    const info = packageInfo("flutter", { analysis });
    assert.ok(info.registry);
    assert.ok(info.profile);
    assert.equal(info.profile.version, "3.0.0");
});

test("packageInfo profile is null when not in analysis", () => {
    const analysis = { profiles: [] };
    const info = packageInfo("flutter", { analysis });
    assert.ok(info.registry);
    assert.equal(info.profile, null);
});

// Regression guard: analyzePackages() had two independent sequential-loop
// bugs discovered live - its own "detect installed" first pass was
// already bounded-concurrency, but the more expensive "build a profile
// per installed package" second pass (packagePrefix/which/du -sk/usage
// detection each) was still a plain for-loop, and getInstalledPackageNames()
// (used directly by `package tree`/`package graph`) had never been
// converted at all. Both made `package analyze/duplicates/orphan/outdated/
// search/unused --json` hang indefinitely on a real, populated machine -
// confirmed directly (25s+ with zero output before the fix). These bounds
// are generous (this really does shell out many times against real
// installed software) but would catch a regression back to unbounded
// sequential processing, which took well over a minute even for a modest
// subset of installed packages.
test("getInstalledPackageNames() resolves in bounded time against the real registry", async () => {
    const start = Date.now();
    const names = await getInstalledPackageNames();
    const elapsedMs = Date.now() - start;
    assert.ok(Array.isArray(names));
    // 120s, not 60s: measured locally at well under 60s, but a real CI
    // runner (shared, resource-constrained) measured ~2.5x slower than
    // this dev machine on the sibling analyzePackages() test below -
    // this bound needs the same real-world headroom, not just a
    // comfortable-looking number picked from local timing alone.
    assert.ok(elapsedMs < 120_000, `expected bounded-concurrency validation to finish well under 120s, took ${elapsedMs}ms`);
});

test("analyzePackages() completes in bounded time and returns a well-formed analysis", async () => {
    const start = Date.now();
    const analysis = await analyzePackages({ useCache: false, silent: true });
    const elapsedMs = Date.now() - start;
    assert.ok(analysis.summary);
    assert.ok(Array.isArray(analysis.profiles));
    assert.ok(Array.isArray(analysis.orphans));
    assert.ok(Array.isArray(analysis.duplicates));
    assert.ok(Array.isArray(analysis.outdated));
    // 300s, not 150s: this exact test measured 34-61s locally but
    // 154.7s on a real GitHub Actions runner (confirmed via a live CI
    // failure, not guessed) - shared CI runners are meaningfully slower
    // than a dev machine for a workload this shell-out-heavy. 300s still
    // gives ~2x margin over the observed CI time while remaining far
    // short of what a true regression to unbounded sequential
    // processing would take.
    assert.ok(elapsedMs < 300_000, `expected bounded-concurrency profile building to finish well under 300s, took ${elapsedMs}ms`);
});
