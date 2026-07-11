// Intelligent Repair Engine command (v1.3.4). Multi-stage diagnostic and
// repair: Scan → Analyze → Plan → Repair → Verify. See core/repair.js.
import path from "node:path";
import { writeFileSync } from "node:fs";
import {
    scanIssues,
    scanCliInstallIssues,
    planRepairs,
    executeRepairs,
    verifyRepairs,
    createRollbackPoint,
    rollback,
    rollbackRepair,
    listRollbackPoints,
    previewRollback,
    runFullRepair,
    listHistory,
    getRepairRecord,
    deleteRepairRecord,
    cleanHistory,
    exportRecord,
    explainIssues,
    explainRepair,
    explainPlan,
    dryRunPlan,
    computeQualityScore,
    rollbackRepairResult,
    benchmarkRepairEngine,
    REPAIR_VERSION,
    REPAIR_CATEGORIES,
    CATEGORY_LABELS,
    RISK_LEVELS,
    RISK_LABELS
} from "../core/repair.js";
import { table, section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";
import chalk from "chalk";

const SEVERITY_COLOR = {
    CRITICAL: chalk.red,
    FATAL: chalk.red,
    WARNING: chalk.yellow,
    INFO: chalk.dim
};

function severityCell(severity) {
    const color = SEVERITY_COLOR[severity] || chalk.dim;
    return color(severity);
}

export function registerRepairCommand(program) {
    const repair = program
        .command("repair")
        .description("Intelligent Repair Engine - detect, analyze, plan, and safely repair environment issues")
        .alias("fix")
        .alias("heal");

    // ─── (default = full pipeline) ───────────────────────────────────
    repair
        .command("run", { isDefault: true })
        .description("Run the full repair pipeline: scan → plan → repair → verify")
        .option("-y, --yes", "skip all confirmation prompts")
        .option("--dry-run", "preview what would be repaired without making changes")
        .option("--skip-benchmark", "skip before/after benchmark comparison")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const record = await runFullRepair({
                assumeYes: opts.yes || false,
                skipBenchmark: opts.skipBenchmark !== false,
                dryRun: opts.dryRun || false,
                silent: Boolean(opts.json)
            });
            if (opts.json) {
                console.log(JSON.stringify(record, null, 2));
            }
        }));

    // ─── install ─────────────────────────────────────────────────────
    // A narrow, fast alternative to `repair run` (which scans all 13
    // subsystems): scans only the CLI-install category - the global
    // symlink, cli/node_modules, and any Homebrew packages the last
    // bootstrap.sh run recorded as failed - and repairs just those. What
    // bootstrap.sh's own failure summary and `devforgekit uninstall`
    // point users to when something's broken, without waiting on a full
    // environment sweep.
    repair
        .command("install")
        .description("Check and repair the DevForgeKit CLI's own install (global symlink, cli deps, failed packages from the last bootstrap.sh run)")
        .option("-y, --yes", "skip all confirmation prompts")
        .option("--dry-run", "preview what would be repaired without making changes")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanCliInstallIssues();

            if (issues.length === 0) {
                if (opts.json) {
                    console.log(JSON.stringify({ issues: [], fixed: 0, failed: 0 }, null, 2));
                } else {
                    logger.success("DevForgeKit's own install is healthy - nothing to repair.");
                }
                return;
            }

            const plan = planRepairs(issues);

            if (opts.dryRun) {
                const preview = dryRunPlan(plan);
                if (opts.json) {
                    console.log(JSON.stringify(preview, null, 2));
                    return;
                }
                logger.section("Repair Install - Dry Run");
                for (const p of preview.preview) {
                    console.log(`  ${p.index}. [${p.severity}] ${p.title}`);
                    console.log(`     ${p.description}`);
                }
                return;
            }

            const { fixed, failed } = await executeRepairs(plan, { assumeYes: opts.yes || false, silent: Boolean(opts.json) });

            if (opts.json) {
                console.log(JSON.stringify({ issues, fixed, failed }, null, 2));
                return;
            }

            if (failed === 0) {
                logger.success(`Repaired ${fixed} issue(s). DevForgeKit's install is healthy.`);
            } else {
                logger.warn(`Repaired ${fixed} issue(s), ${failed} could not be fixed automatically - see above.`);
            }
        }));

    // ─── scan ────────────────────────────────────────────────────────
    repair
        .command("scan")
        .description("Scan for issues across all DevForgeKit subsystems")
        .option("--json", "output issues as JSON")
        .option("--category <cat>", "filter by category")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            let issues = await scanIssues({ silent: Boolean(opts.json) });

            if (opts.category) {
                issues = issues.filter((i) => i.category === opts.category);
            }

            if (opts.json) {
                console.log(JSON.stringify(issues, null, 2));
                return;
            }

            if (issues.length === 0) {
                logger.success("No issues detected - environment is healthy!");
                return;
            }

            const critical = issues.filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL").length;
            const warning = issues.filter((i) => i.severity === "WARNING").length;
            const info = issues.length - critical - warning;

            console.log(section(`Detected Issues (${issues.length})`, [
                table(
                    issues.map((issue) => ({
                        severity: severityCell(issue.severity),
                        issue: issue.title || issue.description,
                        category: issue.categoryLabel || issue.category,
                        risk: issue.riskLabel || "unknown",
                        time: issue.estimatedTime
                    })),
                    [
                        { key: "severity", label: "SEVERITY" },
                        { key: "issue", label: "ISSUE", maxWidth: 45 },
                        { key: "category", label: "CATEGORY" },
                        { key: "risk", label: "RISK" },
                        { key: "time", label: "TIME" }
                    ]
                )
            ]));
            console.log(`\n  ${chalk.red(`${critical} critical`)}, ${chalk.yellow(`${warning} warning`)}, ${chalk.dim(`${info} informational`)}`);
            logger.info("Next: devforgekit repair plan, or devforgekit repair run");
        }));

    // ─── plan ────────────────────────────────────────────────────────
    repair
        .command("plan")
        .description("Generate a repair plan from the last scan or a fresh scan")
        .option("--dry-run", "show what would be done without making changes")
        .option("--json", "output plan as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues({ silent: Boolean(opts.json) });
            const plan = planRepairs(issues);

            if (opts.json) {
                // planRepairs([]) already produces a valid, empty plan -
                // always emit real JSON here rather than an early-return
                // human message, which would otherwise leave --json with
                // no output at all whenever there happen to be zero issues.
                console.log(JSON.stringify(opts.dryRun ? dryRunPlan(plan) : plan, null, 2));
                return;
            }

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to plan.");
                return;
            }

            if (opts.dryRun) {
                const preview = dryRunPlan(plan);
                const summaryLines = [
                    `Repairs: ${preview.totalRepairs} (plus ${preview.totalInfo} informational)`,
                    `Estimated time: ${preview.estimatedTime}`,
                    `Risk level: ${preview.riskLevel}`
                ];
                if (preview.requiresRestart) summaryLines.push("Restart required: yes");
                if (preview.filesAffected.length > 0) summaryLines.push(`Files affected: ${preview.filesAffected.join(", ")}`);
                if (preview.packagesAffected.length > 0) summaryLines.push(`Packages affected: ${preview.packagesAffected.join(", ")}`);
                console.log(section("Dry Run Preview", summaryLines));
                console.log(table(
                    preview.preview.map((p) => ({
                        index: p.index,
                        severity: severityCell(p.severity),
                        title: p.title,
                        action: p.actionType,
                        risk: p.risk
                    })),
                    [
                        { key: "index", label: "#" },
                        { key: "severity", label: "SEVERITY" },
                        { key: "title", label: "TITLE", maxWidth: 45 },
                        { key: "action", label: "ACTION" },
                        { key: "risk", label: "RISK" }
                    ]
                ));
                return;
            }

            const summaryLines = [
                `${plan.totalRepairs} repair(s) + ${plan.totalInfo} informational`,
                `Estimated time: ${plan.estimatedTime}`,
                `Risk level: ${plan.riskLabel}`
            ];
            if (plan.requiresRestart) summaryLines.push("Restart required: yes");
            console.log(section("Repair Plan", summaryLines));
            console.log(table(
                plan.issues.map((issue, i) => ({
                    index: i + 1,
                    severity: severityCell(issue.severity),
                    description: issue.description,
                    fix: issue.fix,
                    risk: issue.riskLabel
                })),
                [
                    { key: "index", label: "#" },
                    { key: "severity", label: "SEVERITY" },
                    { key: "description", label: "ISSUE", maxWidth: 40 },
                    { key: "fix", label: "FIX", maxWidth: 30 },
                    { key: "risk", label: "RISK" }
                ]
            ));

            if (plan.informational.length > 0) {
                console.log(`\n${chalk.bold("Informational (no auto-repair)")}`);
                for (const info of plan.informational) {
                    console.log(`  • ${info.description}`);
                    console.log(`    Suggestion: ${info.fix}`);
                }
            }
            logger.info("Next: devforgekit repair run, or devforgekit repair run --dry-run");
        }));

    // ─── explain ─────────────────────────────────────────────────────
    repair
        .command("explain")
        .description("AI-powered explanation of detected issues (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues();

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to explain.");
                return;
            }

            const result = await explainIssues(issues, {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!result.ok) {
                logger.error(result.error);
                process.exitCode = 1;
                return;
            }
            console.log(result.explanation);
        }));

    // ─── explain-issues ─────────────────────────────────────────────
    repair
        .command("explain-issues")
        .description("Explain repair issues in human-readable format")
        .option("--plan", "explain the full repair plan, not just individual issues")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const issues = await scanIssues({ silent: Boolean(opts.json) });
            const plan = planRepairs(issues);

            if (opts.json) {
                // Same reasoning as `repair plan --json`: emit real JSON
                // (an empty array/plan is still valid) rather than an
                // early-return human message that would leave --json
                // with no output whenever there happen to be zero issues.
                console.log(JSON.stringify(opts.plan ? plan : issues.map(explainRepair), null, 2));
                return;
            }

            if (issues.length === 0) {
                logger.success("No issues detected - nothing to explain.");
                return;
            }

            if (opts.plan) {
                console.log(explainPlan(plan));
            } else {
                for (let i = 0; i < issues.length; i++) {
                    const issue = issues[i];
                    console.log(`\n${"─".repeat(60)}`);
                    console.log(`Issue ${i + 1} of ${issues.length}: ${issue.title || issue.description}`);
                    console.log(`${"─".repeat(60)}`);
                    console.log(explainRepair(issue));
                }
            }
        }));

    // ─── verify ──────────────────────────────────────────────────────
    repair
        .command("verify")
        .description("Run post-repair verification (compatibility, health, workspaces, plugins)")
        .option("--benchmark", "include a quick benchmark in verification")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            await verifyRepairs({ runBenchmark: opts.benchmark || false });
        }));

    // ─── rollback ────────────────────────────────────────────────────
    repair
        .command("rollback <snapshotId>")
        .description("Roll back to a pre-repair snapshot")
        .action(withErrorHandling(async (snapshotId) => {
            await rollback(snapshotId);
        }));

    // ─── rollback-repair ─────────────────────────────────────────────
    repair
        .command("rollback-repair <repairId>")
        .description("Roll back a specific repair by restoring file backups")
        .option("--snapshot", "use the full environment snapshot instead of file backups")
        .option("-y, --yes", "skip confirmation prompt")
        .option("--preview", "preview what would be restored without doing it")
        .action(withErrorHandling(async function (repairId) {
            const opts = this.opts();
            if (opts.preview) {
                const preview = previewRollback(repairId);
                console.log(section(`Rollback Preview: ${repairId}`, [
                    `Created: ${preview.createdAt}`,
                    `Snapshot: ${preview.hasSnapshot ? preview.rollbackSnapshotId : "none"}`,
                    `Repairs reversible: ${preview.repairsReversible}`,
                    `Repairs irreversible: ${preview.repairsIrreversible}`
                ]));
                if (preview.fileBackups.length > 0) {
                    console.log(table(
                        preview.fileBackups.map((fb) => ({
                            status: fb.backupExists ? chalk.green("✓") : chalk.red("✗"),
                            path: fb.originalPath,
                            issue: fb.issue
                        })),
                        [
                            { key: "status", label: "" },
                            { key: "path", label: "FILE", maxWidth: 40 },
                            { key: "issue", label: "ISSUE", maxWidth: 35 }
                        ]
                    ));
                }
                return;
            }
            await rollbackRepair(repairId, { useSnapshot: opts.snapshot || false, assumeYes: opts.yes || false });
        }));

    // ─── rollback-list ───────────────────────────────────────────────
    repair
        .command("rollback-list")
        .description("List repair records that can be rolled back")
        .action(withErrorHandling(() => {
            const points = listRollbackPoints();
            if (points.length === 0) {
                logger.info("No rollback points available.");
                return;
            }
            console.log(section(`Available Rollback Points (${points.length})`, [
                table(
                    points.map((p) => ({
                        id: p.id,
                        fixed: p.fixed,
                        failed: p.failed,
                        snapshot: p.rollbackSnapshotId ? "yes" : "no",
                        date: p.createdAt ? p.createdAt.slice(0, 19).replace("T", " ") : "unknown"
                    })),
                    [
                        { key: "id", label: "ID", maxWidth: 32 },
                        { key: "fixed", label: "FIXED" },
                        { key: "failed", label: "FAILED" },
                        { key: "snapshot", label: "SNAPSHOT" },
                        { key: "date", label: "DATE" }
                    ]
                )
            ]));
            logger.info("Next: devforgekit repair rollback-repair <repairId>");
        }));

    // ─── history ─────────────────────────────────────────────────────
    repair
        .command("history")
        .description("List past repair records")
        .option("--clear", "delete all repair history records")
        .option("--search <query>", "search by ID, machine, platform, or category")
        .option("--filter-risk <risk>", "filter by risk level (none, low, medium, high)")
        .option("--filter-category <cat>", "filter by category label")
        .option("--filter-status <status>", "filter by status (success, failed, partial)")
        .option("--sort <field>", "sort by: date, fixed, failed, quality", "date")
        .option("--limit <n>", "limit number of results", parseInt)
        .option("--json", "output as JSON")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            if (opts.clear) {
                const result = cleanHistory();
                logger.success(`Deleted ${result.deleted} repair record(s)`);
                return;
            }
            const filter = {};
            if (opts.filterRisk) filter.risk = opts.filterRisk;
            if (opts.filterCategory) filter.category = opts.filterCategory;
            if (opts.filterStatus) filter.status = opts.filterStatus;

            const history = listHistory({
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                search: opts.search,
                sortBy: opts.sort,
                limit: opts.limit
            });

            if (opts.json) {
                console.log(JSON.stringify(history, null, 2));
                return;
            }

            if (history.length === 0) {
                logger.info("No repair records found. Run 'devforgekit repair' to start.");
                return;
            }

            console.log(section(`Repair History (${history.length})`, [
                table(
                    history.map((h) => ({
                        id: h.id,
                        issues: h.issueCount,
                        fixed: h.fixed,
                        failed: h.failed,
                        risk: h.riskLabel || h.riskLevel || "unknown",
                        quality: h.qualityScore ? `${h.qualityScore.score}/100 (${h.qualityScore.grade})` : "n/a",
                        date: h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown"
                    })),
                    [
                        { key: "id", label: "ID", maxWidth: 32 },
                        { key: "issues", label: "ISSUES" },
                        { key: "fixed", label: "FIXED" },
                        { key: "failed", label: "FAILED" },
                        { key: "risk", label: "RISK" },
                        { key: "quality", label: "QUALITY" },
                        { key: "date", label: "DATE" }
                    ]
                )
            ]));
            logger.info("Next: devforgekit repair export <id>, or devforgekit repair rollback-repair <id>");
        }));

    // ─── export ──────────────────────────────────────────────────────
    repair
        .command("export <id>")
        .description("Export a repair record (json, markdown, html, csv)")
        .option("-f, --format <format>", "output format: json, markdown, html, csv", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .action(withErrorHandling(function (id) {
            const opts = this.opts();
            const record = getRepairRecord(id);
            const content = exportRecord(record, opts.format);

            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));

    // ─── delete ──────────────────────────────────────────────────────
    repair
        .command("delete <id>")
        .description("Delete a repair record")
        .action(withErrorHandling((id) => {
            const deleted = deleteRepairRecord(id);
            logger.success(`Deleted ${deleted}`);
        }));

    // ─── clean ───────────────────────────────────────────────────────
    repair
        .command("clean")
        .description("Delete all repair history records")
        .action(withErrorHandling(() => {
            const result = cleanHistory();
            logger.success(`Deleted ${result.deleted} repair record(s)`);
        }));

    // ─── benchmark ───────────────────────────────────────────────────
    repair
        .command("benchmark")
        .description("Benchmark repair engine performance (scan, plan, history)")
        .option("-n, --iterations <n>", "number of iterations", parseInt, 3)
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await benchmarkRepairEngine({ iterations: opts.iterations || 3, silent: Boolean(opts.json) });
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));
}
