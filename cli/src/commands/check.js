// Runs the existing scripts/check.sh unchanged, then layers in native
// component-registry validation checks (see
// docs/PlatformArchitecture.md section 9).
import { runScript } from "../core/shell.js";
import { loadPackages, getPackage } from "../core/registry.js";
import { validate as validateComponent } from "../core/installer.js";
import { scoreResults } from "../core/health.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";
import { mapWithConcurrency } from "../core/concurrency.js";

export async function runComponentChecks() {
    const packages = loadPackages().filter((pkg) => pkg.validate);
    return mapWithConcurrency(packages, 8, async (pkg) => {
        try {
            const code = await validateComponent(getPackage(pkg.name));
            return { status: code === 0 ? "PASS" : "WARNING", description: `Component check: ${pkg.name}` };
        } catch {
            return { status: "WARNING", description: `Component check: ${pkg.name} (could not run)` };
        }
    });
}

export function registerCheckCommand(program) {
    program
        .command("check")
        .description("Fast PASS/WARNING/FAIL health check")
        .option("--json", "emit the native component-check results as JSON instead of text")
        .option("--skip-bash", "skip scripts/check.sh and only run native component checks")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            let bashCode = 0;
            if (!opts.skipBash && !opts.json) {
                bashCode = await runScript("scripts/check.sh", []);
            }

            const results = await runComponentChecks();
            const { score, verdict, ...tally } = scoreResults(results);

            if (opts.json) {
                console.log(JSON.stringify({ results, ...tally, score, verdict }, null, 2));
            } else {
                logger.section("Component checks");
                for (const r of results) {
                    if (r.status === "PASS") logger.success(r.description);
                    else logger.warn(r.description);
                }
                logger.info(`Component health score: ${score}% - ${verdict}`);
            }

            process.exitCode = bashCode !== 0 ? bashCode : 0;
        }));
}
