// Package Intelligence & Analytics command (v1.3.5). See core/packageIntel.js.
import { writeFileSync } from "node:fs";
import {
    analyzePackages,
    packageInfo,
    buildGraph,
    renderTree,
    packageImpact,
    searchPackages,
    compareAnalyses,
    recommend,
    exportAnalysis,
    saveAnalysis,
    listHistory,
    loadAnalysis,
    clearCache,
    formatBytes,
    getInstalledPackageNames
} from "../core/packageIntel.js";
import { getPackage } from "../core/registry.js";
import { table, section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";

export function registerPackageCommand(program) {
    const pkg = program
        .command("package")
        .description("Package Intelligence & Analytics - analyze installed development tools")
        .alias("packages")
        .alias("pkg");

    // ─── analyze ─────────────────────────────────────────────────────
    pkg
        .command("analyze")
        .description("Analyze all installed packages and build intelligence profiles")
        .option("--no-cache", "ignore cached results, force full rescan")
        .option("--json", "output analysis as JSON")
        .option("--save", "save analysis to history")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: opts.cache, silent: Boolean(opts.json) });

            if (opts.save) {
                const filePath = saveAnalysis(analysis);
                logger.success(`Saved to ${filePath}`);
            }

            if (opts.json) {
                console.log(JSON.stringify(analysis, null, 2));
                return;
            }

            console.log(section("Package Intelligence Summary", [
                `Packages:   ${analysis.summary.total} (${formatBytes(analysis.summary.totalSizeBytes || 0)})`,
                `Orphans:    ${analysis.summary.orphanCount}`,
                `Duplicates: ${analysis.summary.duplicateCount}`,
                `Outdated:   ${analysis.summary.outdatedCount}`
            ]));
            logger.info("Next: devforgekit package orphan, devforgekit package duplicates, or devforgekit package outdated");
        }));

    // ─── info ────────────────────────────────────────────────────────
    pkg
        .command("info <name>")
        .description("Show complete information about a package")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });
            const info = packageInfo(name, { analysis });

            if (opts.json) {
                console.log(JSON.stringify(info, null, 2));
                return;
            }

            const { registry: reg, profile } = info;

            logger.section(`Package: ${reg.name}`);
            console.log(`\n  Description: ${reg.description || "N/A"}`);
            console.log(`  Category: ${reg.category || "N/A"}`);
            console.log(`  License: ${reg.license || "N/A"}`);
            console.log(`  Homepage: ${reg.homepage || "N/A"}`);
            console.log(`  Repository: ${reg.repository || "N/A"}`);
            console.log(`  Maintainer: ${reg.maintainer || "N/A"}`);
            console.log(`  Stability: ${reg.stability || "N/A"}`);
            console.log(`  Tags: ${(reg.tags || []).join(", ") || "N/A"}`);
            console.log(`  Dependencies: ${(reg.dependencies || []).join(", ") || "none"}`);

            if (profile) {
                console.log(`\n  Installed: yes`);
                console.log(`  Version: ${profile.version || "unknown"}`);
                console.log(`  Install method: ${profile.installMethod}`);
                console.log(`  Install location: ${profile.installLocation || "unknown"}`);
                console.log(`  Size: ${formatBytes(profile.sizeBytes || 0)}`);
                console.log(`  Health: ${profile.healthStatus}`);
                console.log(`  Compatibility: ${profile.compatibilityScore ?? "N/A"}`);
                console.log(`  Last used: ${profile.lastUsed || "unknown"}`);
                console.log(`  Times executed: ${profile.timesExecuted || 0}`);
                console.log(`  Reverse dependencies: ${(profile.reverseDependencies || []).join(", ") || "none"}`);
                console.log(`  Workspace usage: ${(profile.workspaceUsage || []).join(", ") || "none"}`);
                console.log(`  Recipe usage: ${(profile.recipeUsage || []).join(", ") || "none"}`);
                console.log(`  Profile usage: ${(profile.profileUsage || []).join(", ") || "none"}`);
                console.log(`  Collection usage: ${(profile.collectionUsage || []).join(", ") || "none"}`);
                console.log(`  Plugin usage: ${(profile.pluginUsage || []).join(", ") || "none"}`);
                console.log(`  Orphan: ${profile.isOrphan ? "yes" : "no"}`);
                console.log(`  Duplicate: ${profile.isDuplicate ? "yes" : "no"}`);
                console.log(`  Outdated: ${profile.isOutdated ? "yes" : "no"}`);
            } else {
                console.log(`\n  Installed: no`);
            }
        }));

    // ─── tree ────────────────────────────────────────────────────────
    pkg
        .command("tree [name]")
        .description("Show dependency tree for a package (or all installed packages)")
        .action(withErrorHandling(async function (name) {
            if (name) {
                const tree = renderTree([name]);
                console.log(tree);
            } else {
                const installed = await getInstalledPackageNames();
                // Show trees for top-level packages (no reverse deps)
                const tree = renderTree(installed);
                console.log(tree);
            }
        }));

    // ─── graph ───────────────────────────────────────────────────────
    pkg
        .command("graph [name]")
        .description("Show dependency graph for a package (or all installed packages)")
        .option("--format <format>", "output format: text, dot, mermaid", "text")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const names = name ? [name] : await getInstalledPackageNames();
            const graph = buildGraph(names);

            if (opts.format === "dot") {
                console.log("digraph packages {");
                for (const edge of graph.edges) {
                    console.log(`  "${edge.from}" -> "${edge.to}";`);
                }
                console.log("}");
            } else if (opts.format === "mermaid") {
                console.log("graph LR");
                for (const edge of graph.edges) {
                    console.log(`  ${edge.from} --> ${edge.to}`);
                }
            } else {
                logger.section("Dependency Graph");
                console.log(`\n  Nodes: ${graph.nodes.length}`);
                console.log(`  Edges: ${graph.edges.length}`);
                if (graph.missing.length > 0) {
                    console.log(`  Missing: ${graph.missing.join(", ")}`);
                }
                if (graph.cycles.length > 0) {
                    console.log(`  Cycles:`);
                    for (const cycle of graph.cycles) {
                        console.log(`    ${cycle.join(" -> ")}`);
                    }
                }
                console.log("\n  Nodes:");
                for (const node of graph.nodes) {
                    console.log(`    ${node.name} (depth: ${node.depth}, reverse deps: ${node.reverseDependencies.length})`);
                }
            }
        }));

    // ─── orphan ──────────────────────────────────────────────────────
    pkg
        .command("orphan")
        .description("Detect orphan packages that can potentially be removed")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });

            if (opts.json) {
                console.log(JSON.stringify(analysis.orphans, null, 2));
                return;
            }

            logger.section("Orphan Packages");
            if (analysis.orphans.length === 0) {
                logger.success("No orphan packages detected");
                return;
            }

            for (const orphan of analysis.orphans) {
                console.log(`\n  ${orphan.name} (${formatBytes(orphan.sizeBytes || 0)})`);
                console.log(`    Reason: ${orphan.reason}`);
                console.log(`    Last used: ${orphan.lastUsed || "unknown"}`);
                console.log(`    Safe to remove: ${orphan.safeToRemove ? "yes" : "unknown"}`);
            }
            console.log(`\n  ${analysis.orphans.length} orphan package(s)`);
        }));

    // ─── duplicates ──────────────────────────────────────────────────
    pkg
        .command("duplicates")
        .description("Detect duplicate packages and installations")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });

            if (opts.json) {
                console.log(JSON.stringify(analysis.duplicates, null, 2));
                return;
            }

            logger.section("Duplicate Packages");
            if (analysis.duplicates.length === 0) {
                logger.success("No duplicate packages detected");
                return;
            }

            for (const dupe of analysis.duplicates) {
                console.log(`\n  ${dupe.label}`);
                console.log(`    Packages: ${dupe.packages.join(", ")}`);
                console.log(`    Suggestion: ${dupe.suggestion}`);
            }
            console.log(`\n  ${analysis.duplicates.length} duplicate group(s)`);
        }));

    // ─── unused ──────────────────────────────────────────────────────
    pkg
        .command("unused")
        .description("Detect unused packages (alias for orphan)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });

            if (opts.json) {
                console.log(JSON.stringify(analysis.orphans, null, 2));
                return;
            }

            logger.section("Unused Packages");
            if (analysis.orphans.length === 0) {
                logger.success("No unused packages detected");
                return;
            }

            for (const orphan of analysis.orphans) {
                console.log(`\n  ${orphan.name} (${formatBytes(orphan.sizeBytes || 0)})`);
                console.log(`    Last used: ${orphan.lastUsed || "unknown"}`);
                console.log(`    Times executed: ${orphan.timesExecuted || 0}`);
            }
            console.log(`\n  ${analysis.orphans.length} unused package(s)`);
        }));

    // ─── outdated ────────────────────────────────────────────────────
    pkg
        .command("outdated")
        .description("Detect outdated packages")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });

            if (opts.json) {
                console.log(JSON.stringify(analysis.outdated, null, 2));
                return;
            }

            logger.section("Outdated Packages");
            if (analysis.outdated.length === 0) {
                logger.success("All packages are up to date");
                return;
            }

            for (const outdated of analysis.outdated) {
                console.log(`\n  ${outdated.name} (v${outdated.currentVersion})`);
                console.log(`    Reason: ${outdated.reason}`);
                console.log(`    Update: ${outdated.updateCommand}`);
            }
            console.log(`\n  ${analysis.outdated.length} outdated package(s)`);
        }));

    // ─── recommend ───────────────────────────────────────────────────
    pkg
        .command("recommend")
        .description("AI-powered package recommendations (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });

            const result = await recommend(analysis, {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!result.ok) {
                logger.error(result.error);
                process.exitCode = 1;
                return;
            }
            console.log(result.recommendation);
        }));

    // ─── impact ──────────────────────────────────────────────────────
    pkg
        .command("impact <name>")
        .description("Show the impact of a package on the environment")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });
            const impact = await packageImpact(name, { analysis });

            if (opts.json) {
                console.log(JSON.stringify(impact, null, 2));
                return;
            }

            logger.section(`Impact: ${name}`);
            console.log(`\n  Size: ${impact.sizeFormatted}`);
            console.log(`  Dependencies: ${impact.dependencyCount}`);
            console.log(`  Reverse dependencies: ${impact.reverseDependencyCount}`);
            if (impact.reverseDependencies.length > 0) {
                console.log(`    ${impact.reverseDependencies.join(", ")}`);
            }
            console.log(`  Health: ${impact.healthStatus}`);
            console.log(`  Compatibility: ${impact.compatibilityScore ?? "N/A"}`);
            console.log(`  Last used: ${impact.lastUsed || "unknown"}`);
            console.log(`  Orphan: ${impact.isOrphan ? "yes" : "no"}`);
            console.log(`  Duplicate: ${impact.isDuplicate ? "yes" : "no"}`);
            console.log(`  Outdated: ${impact.isOutdated ? "yes" : "no"}`);

            if (impact.workspaceUsage.length > 0) {
                console.log(`  Workspaces: ${impact.workspaceUsage.join(", ")}`);
            }
            if (impact.recipeUsage.length > 0) {
                console.log(`  Recipes: ${impact.recipeUsage.join(", ")}`);
            }
            if (impact.profileUsage.length > 0) {
                console.log(`  Profiles: ${impact.profileUsage.join(", ")}`);
            }

            console.log(`\n  Removal Impact:`);
            console.log(`    Can remove safely: ${impact.removalImpact.canRemoveSafely ? "yes" : "no"}`);
            if (impact.removalImpact.warning) {
                console.log(`    Warning: ${impact.removalImpact.warning}`);
            }
            console.log(`    Space reclaimed: ${formatBytes(impact.removalImpact.estimatedSpaceReclaimed)}`);
        }));

    // ─── search ──────────────────────────────────────────────────────
    pkg
        .command("search [query]")
        .description("Search installed packages by name, tag, description, category, workspace, recipe, or profile")
        .option("-f, --filter <filter>", "filter: installed, outdated, unused, duplicated, broken, large, small, most-used, least-used")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (query) {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });
            const results = searchPackages(analysis, query, { filter: opts.filter });

            if (opts.json) {
                console.log(JSON.stringify(results, null, 2));
                return;
            }

            logger.section("Search Results");
            if (results.length === 0) {
                logger.info("No packages found");
                return;
            }

            for (const p of results) {
                const flags = [
                    p.isOrphan ? "orphan" : null,
                    p.isDuplicate ? "duplicate" : null,
                    p.isOutdated ? "outdated" : null,
                    p.healthStatus === "broken" ? "broken" : null
                ].filter(Boolean).join(", ");
                console.log(`\n  ${p.name} (${p.version || "?"}) - ${p.category || "?"} [${formatBytes(p.sizeBytes || 0)}]${flags ? ` (${flags})` : ""}`);
                if (p.description) console.log(`    ${p.description}`);
            }
            console.log(`\n  ${results.length} package(s)`);
        }));

    // ─── compare ─────────────────────────────────────────────────────
    pkg
        .command("compare <oldFile> <newFile>")
        .description("Compare two analysis files and show changes")
        .action(withErrorHandling((oldFile, newFile) => {
            const oldAnalysis = loadAnalysis(oldFile);
            const newAnalysis = loadAnalysis(newFile);
            const comparison = compareAnalyses(oldAnalysis, newAnalysis);

            logger.section("Package Comparison");
            console.log(`\n  Added: ${comparison.summary.addedCount}`);
            for (const a of comparison.added) {
                console.log(`    + ${a.name} (${a.version || "?"}) [${formatBytes(a.sizeBytes || 0)}]`);
            }

            console.log(`\n  Removed: ${comparison.summary.removedCount}`);
            for (const r of comparison.removed) {
                console.log(`    - ${r.name} (${r.version || "?"}) [${formatBytes(r.sizeBytes || 0)}]`);
            }

            console.log(`\n  Updated: ${comparison.summary.updatedCount}`);
            for (const u of comparison.updated) {
                console.log(`    * ${u.name} (${u.oldVersion || "?"} → ${u.newVersion || "?"})`);
            }

            console.log(`\n  Unchanged: ${comparison.summary.unchangedCount}`);
        }));

    // ─── history ─────────────────────────────────────────────────────
    pkg
        .command("history")
        .description("List past package analysis records")
        .action(withErrorHandling(() => {
            const history = listHistory();
            if (history.length === 0) {
                logger.info("No analysis records found. Run 'devforgekit package analyze --save' to create one.");
                return;
            }

            console.log(section(`Analysis History (${history.length})`, [
                table(
                    history.map((h) => ({
                        date: h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown",
                        total: h.total,
                        size: formatBytes(h.totalSizeBytes || 0),
                        orphans: h.orphanCount,
                        duplicates: h.duplicateCount,
                        outdated: h.outdatedCount
                    })),
                    [
                        { key: "date", label: "DATE" },
                        { key: "total", label: "PACKAGES" },
                        { key: "size", label: "SIZE" },
                        { key: "orphans", label: "ORPHANS" },
                        { key: "duplicates", label: "DUPLICATES" },
                        { key: "outdated", label: "OUTDATED" }
                    ]
                )
            ]));
        }));

    // ─── export ──────────────────────────────────────────────────────
    pkg
        .command("export [format]")
        .description("Export analysis (json, markdown, html, csv, dot, mermaid)")
        .option("-f, --format <format>", "output format", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .option("--save", "save analysis first before exporting")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const analysis = await analyzePackages({ useCache: true, silent: Boolean(opts.json) });

            if (opts.save) {
                saveAnalysis(analysis);
            }

            const format = opts.format || "markdown";
            const content = exportAnalysis(analysis, format);

            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));
}
