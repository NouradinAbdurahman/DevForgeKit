// Benchmark Engine command (v2.1.7). Measures development environment
// performance with real developer workloads. See core/benchmark.js.
import path from "node:path";
import { writeFileSync } from "node:fs";
import {
    runBenchmark,
    saveResult,
    listHistory,
    getResult,
    deleteResult,
    compareResults,
    exportResult,
    explainResult,
    gradeForScore,
    benchmarkSummary,
    getTrend,
    getTrendSummary,
    renderSparkline,
    explainBenchmark,
    explainBenchmarkResult,
    generateRichReport,
    BENCHMARK_METADATA
} from "../core/benchmark.js";
import { table, section } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import chalk from "chalk";

export function registerBenchmarkCommand(program) {
    const benchmark = program
        .command("benchmark")
        .description("Benchmark Engine - measure development environment performance")
        .alias("bench")
        .alias("perf");

    // ─── (default = quick) ───────────────────────────────────────────
    benchmark
        .command("quick", { isDefault: true })
        .description("Quick benchmark (~10-20s): CPU, disk, git, node, shell, memory")
        .option("--no-save", "don't save result to history")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await runBenchmark({ profile: "quick", silent: Boolean(opts.json) });
            if (opts.save) saveResult(result);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));

    // ─── full ────────────────────────────────────────────────────────
    benchmark
        .command("full")
        .description("Full benchmark (~2-5min): all categories including project generation")
        .option("--no-save", "don't save result to history")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await runBenchmark({ profile: "full", silent: Boolean(opts.json) });
            if (opts.save) saveResult(result);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));

    // ─── standard ────────────────────────────────────────────────────
    benchmark
        .command("standard")
        .description("Standard benchmark (~30-60s): quick + docker, flutter, python, databases, package managers")
        .option("--no-save", "don't save result to history")
        .option("--json", "output result as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const result = await runBenchmark({ profile: "standard", silent: Boolean(opts.json) });
            if (opts.save) saveResult(result);
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
            }
        }));

    // ─── compare ─────────────────────────────────────────────────────
    benchmark
        .command("compare [old] [new]")
        .description("Compare two benchmark results (by ID, or latest two if omitted)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async (oldId, newId) => {
            let oldResult, newResult;

            if (oldId && newId) {
                oldResult = getResult(oldId);
                newResult = getResult(newId);
            } else {
                const history = listHistory();
                if (history.length < 2) {
                    logger.error("Need at least 2 benchmark results to compare. Run 'devforgekit benchmark' first.");
                    process.exitCode = 1;
                    return;
                }
                oldResult = getResult(history[1].id);
                newResult = getResult(history[0].id);
            }

            const comparison = compareResults(oldResult, newResult);

            if (this.opts().json) {
                console.log(JSON.stringify(comparison, null, 2));
                return;
            }

            const summaryLines = [
                `Old: ${comparison.old.createdAt} - ${comparison.old.overallScore}/100 (${comparison.old.overallGrade}) on ${comparison.old.machine}`,
                `New: ${comparison.new.createdAt} - ${comparison.new.overallScore}/100 (${comparison.new.overallGrade}) on ${comparison.new.machine}`
            ];
            if (comparison.overallDelta !== null) {
                const sign = comparison.overallDelta > 0 ? "+" : "";
                const status = comparison.overallDelta > 0 ? "improved" : comparison.overallDelta < 0 ? "regressed" : "unchanged";
                summaryLines.push(`Overall: ${comparison.old.overallScore} → ${comparison.new.overallScore} (${sign}${comparison.overallDelta}, ${status})`);
            }
            if (comparison.summary) {
                summaryLines.push(`Summary: ${comparison.summary.improved} improved, ${comparison.summary.regressed} regressed, ${comparison.summary.unchanged} unchanged, ${comparison.summary.significant} significant`);
            }
            console.log(section("Benchmark Comparison", summaryLines));

            const statusColor = { improved: chalk.green, regressed: chalk.red, unchanged: chalk.dim };
            console.log(table(
                comparison.categories.map((cat) => {
                    const symbol = cat.status === "improved" ? "↑" : cat.status === "regressed" ? "↓" : cat.status === "unchanged" ? "=" : "?";
                    const color = statusColor[cat.status] || chalk.dim;
                    const deltaStr = cat.delta != null ? (cat.delta > 0 ? `+${cat.delta}` : String(cat.delta)) : "N/A";
                    return {
                        status: color(symbol),
                        category: `${cat.label || cat.category}${cat.significant ? " *" : ""}`,
                        old: cat.oldScore != null ? String(cat.oldScore) : "N/A",
                        new: cat.newScore != null ? String(cat.newScore) : "N/A",
                        delta: color(deltaStr)
                    };
                }),
                [
                    { key: "status", label: "" },
                    { key: "category", label: "CATEGORY", maxWidth: 25 },
                    { key: "old", label: "OLD" },
                    { key: "new", label: "NEW" },
                    { key: "delta", label: "DELTA" }
                ]
            ));

            for (const cat of comparison.categories) {
                if (!cat.significant) continue;
                if (cat.likelyCause) console.log(`\n  ${chalk.bold(cat.label || cat.category)} - Likely cause: ${cat.likelyCause}`);
                if (cat.recommendation) console.log(`    Recommendation: ${cat.recommendation}`);
                for (const m of cat.measurementDeltas || []) {
                    const mSym = m.faster ? "↑" : "↓";
                    const mPctStr = m.pct > 0 ? `+${m.pct}%` : `${m.pct}%`;
                    console.log(`    ${mSym} ${m.measurement}: ${m.oldMs}ms → ${m.newMs}ms (${mPctStr})`);
                }
            }
            console.log(`\n  * = significant change (≥10% threshold)`);
        }));

    // ─── history ─────────────────────────────────────────────────────
    benchmark
        .command("history")
        .description("List past benchmark results")
        .option("--filter-profile <profile>", "filter by profile (quick, standard, full)")
        .option("--filter-grade <grade>", "filter by grade (A+, A, B, C, D, F)")
        .option("--min-score <score>", "filter by minimum score", parseInt)
        .option("--max-score <score>", "filter by maximum score", parseInt)
        .option("--search <query>", "search across id, machine, profile, os")
        .option("--sort <field>", "sort by: date, score, duration", "date")
        .option("--limit <n>", "limit number of results", parseInt)
        .option("--json", "output as JSON")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const filter = {};
            if (opts.filterProfile) filter.profile = opts.filterProfile;
            if (opts.filterGrade) filter.grade = opts.filterGrade;
            if (opts.minScore != null) filter.minScore = opts.minScore;
            if (opts.maxScore != null) filter.maxScore = opts.maxScore;

            const history = listHistory({
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                search: opts.search,
                sortBy: opts.sort === "score" ? "score" : opts.sort === "duration" ? "duration" : "date",
                limit: opts.limit
            });

            if (opts.json) {
                console.log(JSON.stringify(history, null, 2));
                return;
            }

            if (history.length === 0) {
                logger.info("No benchmark results found. Run 'devforgekit benchmark' to create one.");
                return;
            }

            console.log(section(`Benchmark History (${history.length})`, [
                table(
                    history.map((h) => ({
                        id: h.id,
                        profile: h.profile,
                        score: h.overallScore ?? 0,
                        grade: h.overallGrade || "F",
                        date: h.createdAt ? h.createdAt.slice(0, 19).replace("T", " ") : "unknown"
                    })),
                    [
                        { key: "id", label: "ID", maxWidth: 32 },
                        { key: "profile", label: "PROFILE" },
                        { key: "score", label: "SCORE" },
                        { key: "grade", label: "GRADE" },
                        { key: "date", label: "DATE" }
                    ]
                )
            ]));
            logger.info("Next: devforgekit benchmark report <id>, or devforgekit benchmark compare");
        }));

    // ─── export ──────────────────────────────────────────────────────
    benchmark
        .command("export <id>")
        .description("Export a benchmark result (json, markdown, html, csv)")
        .option("-f, --format <format>", "output format: json, markdown, html, csv", "markdown")
        .option("-o, --output <file>", "output file (default: stdout)")
        .action(withErrorHandling(function (id) {
            const opts = this.opts();
            const result = getResult(id);
            const content = exportResult(result, opts.format);

            if (opts.output) {
                writeFileSync(opts.output, content);
                logger.success(`Exported to ${opts.output}`);
            } else {
                console.log(content);
            }
        }));

    // ─── delete ──────────────────────────────────────────────────────
    benchmark
        .command("delete <id>")
        .description("Delete a benchmark result")
        .action(withErrorHandling((id) => {
            const deleted = deleteResult(id);
            logger.success(`Deleted ${deleted}`);
        }));

    // ─── explain ─────────────────────────────────────────────────────
    benchmark
        .command("explain [id]")
        .description("AI-powered explanation of benchmark results (requires AI provider)")
        .option("--provider <id>", "AI provider to use")
        .option("--model <model>", "model override")
        .option("--endpoint <url>", "custom API endpoint")
        .action(withErrorHandling(async function (id) {
            const opts = this.opts();
            let result;
            if (id) {
                result = getResult(id);
            } else {
                const history = listHistory();
                if (history.length === 0) {
                    logger.error("No benchmark results found. Run 'devforgekit benchmark' first.");
                    process.exitCode = 1;
                    return;
                }
                result = getResult(history[0].id);
            }

            const explanation = await explainResult(result, {
                provider: opts.provider,
                model: opts.model,
                endpoint: opts.endpoint
            });
            if (!explanation.ok) {
                logger.error(explanation.error);
                process.exitCode = 1;
                return;
            }
            console.log(explanation.explanation);
        }));

    // ─── trend ──────────────────────────────────────────────────────
    benchmark
        .command("trend [category]")
        .description("Show trend analysis for a category (or overall) across history")
        .option("-n, --limit <n>", "number of history points", parseInt, 10)
        .option("--json", "output as JSON")
        .action(withErrorHandling(function (category) {
            const opts = this.opts();
            const cat = category || "overall";
            const summary = getTrendSummary(cat, { limit: opts.limit || 10 });

            if (opts.json) {
                console.log(JSON.stringify(summary, null, 2));
                return;
            }

            const label = BENCHMARK_METADATA?.[cat]?.label || cat;
            logger.section(`Trend: ${label}`);

            if (summary.trend === "insufficient data") {
                logger.info("Not enough data points for trend analysis. Run more benchmarks.");
                return;
            }

            console.log(`\n  Direction: ${summary.direction}`);
            console.log(`  Change: ${summary.first} → ${summary.last} (${summary.delta > 0 ? "+" : ""}${summary.delta})`);
            console.log(`  Average: ${summary.avg}`);
            console.log(`  Volatility: ±${summary.volatility}`);
            console.log(`\n  Sparkline:  ${summary.sparkline}`);
            console.log(`\n  History:`);
            for (const p of summary.points) {
                const date = p.createdAt?.slice(0, 10) || "?";
                console.log(`    ${date}  ${String(p.score).padStart(3)}/100  (${p.grade})`);
            }
        }));

    // ─── intelligence ────────────────────────────────────────────────
    benchmark
        .command("intelligence [id]")
        .description("Self-explaining benchmark report (no AI needed)")
        .option("--category <cat>", "explain a specific category only")
        .action(withErrorHandling(function (id) {
            let result;
            if (id) {
                result = getResult(id);
            } else {
                const history = listHistory();
                if (history.length === 0) {
                    logger.error("No benchmark results found. Run 'devforgekit benchmark' first.");
                    process.exitCode = 1;
                    return;
                }
                result = getResult(history[0].id);
            }

            const opts = this.opts();
            if (opts.category) {
                console.log(explainBenchmark(opts.category, result));
            } else {
                console.log(explainBenchmarkResult(result));
            }
        }));

    // ─── report ──────────────────────────────────────────────────────
    benchmark
        .command("report [id]")
        .description("Rich benchmark report with previous comparison")
        .action(withErrorHandling(function (id) {
            let result;
            if (id) {
                result = getResult(id);
            } else {
                const history = listHistory();
                if (history.length === 0) {
                    logger.error("No benchmark results found. Run 'devforgekit benchmark' first.");
                    process.exitCode = 1;
                    return;
                }
                result = getResult(history[0].id);
            }

            // Get previous result for comparison
            const history = listHistory({ limit: 10 });
            const currentIdx = history.findIndex((h) => h.id === result.id);
            const previousResult = currentIdx >= 0 && currentIdx + 1 < history.length
                ? getResult(history[currentIdx + 1].id)
                : null;

            console.log(generateRichReport(result, { previousResult }));
        }));
}
