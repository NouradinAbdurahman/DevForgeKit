// The Intelligent Repair Engine (v1.3.4). A multi-stage diagnostic and
// repair platform: Scan → Analyze → Plan → Repair → Verify.
//
// This is NOT just another doctor command. It is a comprehensive repair
// system that detects problems across every DevForgeKit subsystem,
// generates an ordered repair plan with dependency awareness, safely
// executes repairs with user confirmation and automatic rollback, and
// verifies results with benchmark + compatibility comparison.
//
// Reuses every existing subsystem - no duplicated logic:
//   - compatibility/engine.js (scanCompatibility) for compatibility issues
//   - compatibility/repair.js (planRepair/executeRepairPlan) for compat repairs
//   - installer.js (install/uninstall) for package management
//   - shell.js (runShellCommand/captureShellCommand/commandExists) for probes
//   - registry.js (loadPackages) for component detection
//   - snapshot.js (createSnapshot) for pre-repair rollback points
//   - benchmark.js (runBenchmark) for before/after performance comparison
//   - health.js (scoreResults) for health scoring
//   - ai/providers + ai/prompts/library.js for AI explanations
//   - config.js for configuration validation
//   - workspace/store.js for workspace validation
//   - plugins.js for plugin validation
//   - self-update.js for config backup/restore
//   - paths.js, version.js, logger.js, errors.js
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, copyFileSync, renameSync } from "node:fs";
import { tmpdir, hostname, userInfo } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "./shell.js";
import { userStateDir, userConfigDir, homeDir, repoRoot, scriptPath } from "./paths.js";
import { loadConfig, getConfigValue } from "./config.js";
import { loadPackages, getPackage } from "./registry.js";
import { validate, install, uninstall, repair as repairComponent, resolveInstallStep } from "./installer.js";
import { mapWithConcurrency } from "./concurrency.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";
import { scanCompatibility, scoreCompatibility } from "./compatibility/engine.js";
import { planRepair as planCompatRepair, executeRepairPlan as executeCompatRepair } from "./compatibility/repair.js";
import { scoreResults } from "./health.js";
import { getPlatform } from "./platform/index.js";
import { listWorkspaces } from "./workspace/store.js";
import { discoverPlugins } from "./plugins.js";
import { confirm } from "../lib/prompts.js";

// ─── Repair Categories (Phase 2) ─────────────────────────────────────

export const REPAIR_CATEGORIES = {
  CONFIGURATION: "configuration",
  DEPENDENCIES: "dependencies",
  PACKAGE_MANAGER: "package-manager",
  REGISTRY: "registry",
  ENVIRONMENT: "environment",
  PERMISSIONS: "permissions",
  WORKSPACE: "workspace",
  SHELL: "shell",
  GIT: "git",
  NODE: "node",
  PYTHON: "python",
  JAVA: "java",
  FLUTTER: "flutter",
  DOCKER: "docker",
  HOMEBREW: "homebrew",
  AI: "ai",
  PROFILES: "profiles",
  RECIPES: "recipes",
  PLUGINS: "plugins",
  SYSTEM: "system",
  COMPATIBILITY: "compatibility",
  PATH: "path",
  SYMLINK: "symlink",
  SERVICE: "service",
  DISK: "disk",
  SSH: "ssh",
  CACHE: "cache",
  CLI_INSTALL: "cli-install",
};

export const CATEGORY_LABELS = {
  [REPAIR_CATEGORIES.CONFIGURATION]: "Configuration",
  [REPAIR_CATEGORIES.DEPENDENCIES]: "Dependencies",
  [REPAIR_CATEGORIES.PACKAGE_MANAGER]: "Package Manager",
  [REPAIR_CATEGORIES.REGISTRY]: "Registry",
  [REPAIR_CATEGORIES.ENVIRONMENT]: "Environment",
  [REPAIR_CATEGORIES.PERMISSIONS]: "Permissions",
  [REPAIR_CATEGORIES.WORKSPACE]: "Workspace",
  [REPAIR_CATEGORIES.SHELL]: "Shell",
  [REPAIR_CATEGORIES.GIT]: "Git",
  [REPAIR_CATEGORIES.NODE]: "Node",
  [REPAIR_CATEGORIES.PYTHON]: "Python",
  [REPAIR_CATEGORIES.JAVA]: "Java",
  [REPAIR_CATEGORIES.FLUTTER]: "Flutter",
  [REPAIR_CATEGORIES.DOCKER]: "Docker",
  [REPAIR_CATEGORIES.HOMEBREW]: "Homebrew",
  [REPAIR_CATEGORIES.AI]: "AI",
  [REPAIR_CATEGORIES.PROFILES]: "Profiles",
  [REPAIR_CATEGORIES.RECIPES]: "Recipes",
  [REPAIR_CATEGORIES.PLUGINS]: "Plugins",
  [REPAIR_CATEGORIES.SYSTEM]: "System",
  [REPAIR_CATEGORIES.COMPATIBILITY]: "Compatibility",
  [REPAIR_CATEGORIES.PATH]: "PATH",
  [REPAIR_CATEGORIES.SYMLINK]: "Symlink",
  [REPAIR_CATEGORIES.SERVICE]: "Service",
  [REPAIR_CATEGORIES.DISK]: "Disk",
  [REPAIR_CATEGORIES.SSH]: "SSH",
  [REPAIR_CATEGORIES.CACHE]: "Cache",
  [REPAIR_CATEGORIES.CLI_INSTALL]: "CLI Install",
};

// ─── Risk Levels (Phase 3) ───────────────────────────────────────────

export const RISK_LEVELS = {
  NONE: "none",
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

export const RISK_LABELS = {
  [RISK_LEVELS.NONE]: "None",
  [RISK_LEVELS.LOW]: "Low",
  [RISK_LEVELS.MEDIUM]: "Medium",
  [RISK_LEVELS.HIGH]: "High",
};

const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3 };

// ─── Repair Action Types (Phase 3) ───────────────────────────────────
// Structured action replacing raw fix strings. Every repair now declares
// what it will do in a machine-readable format, not a freeform string.

export const ACTION_TYPES = {
  SHELL: "shell",
  INSTALL: "install",
  UNINSTALL: "uninstall",
  COMPATIBILITY: "compatibility",
  COMPONENT_REPAIR: "component-repair",
  MANUAL: "manual",
};

// ─── Shared helper (fixes duplicated logic) ──────────────────────────
// The loadPackages() → validate → collect installed names loop appeared
// 4+ times in this file and once in commands/doctor.js. Single source now.

async function getInstalledPackageNames() {
  const packages = loadPackages().filter((pkg) => pkg.validate);
  const validated = await mapWithConcurrency(packages, 8, async (pkg) => {
    try {
      return (await validate(pkg)) === 0 ? pkg.name : null;
    } catch {
      return null;
    }
  });
  return validated.filter(Boolean);
}

// ─── Constants ────────────────────────────────────────────────────────

export const REPAIR_VERSION = 2;
export const REPAIR_DIR = "repairs";

const SEVERITY_ORDER = { FATAL: 0, CRITICAL: 1, WARNING: 2, INFO: 3 };
const SEVERITY_LABELS = { FATAL: "FATAL", CRITICAL: "CRITICAL", WARNING: "WARNING", INFO: "INFO" };

function repairsDir() {
    return path.join(userStateDir(), REPAIR_DIR);
}

function makeRepairId(isoTimestamp) {
    return `${isoTimestamp.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

// ─── Issue shape (Phase 3: Repair Metadata) ───────────────────────────
// Every issue now carries full metadata: a structured repair action (not
// a raw fix string), risk level, title, supportsDryRun, platform support,
// and version introduced. The `fix` string remains for backward-compatible
// display, but `action` is the authoritative machine-readable repair.

function makeIssue({
    id, severity, category, subsystem, description, impact, fix,
    estimatedTime, requiresRestart = false, rollbackAvailable = true,
    confidence = "high", dependencies = [],
    title, risk = RISK_LEVELS.LOW, supportsDryRun = true,
    platforms = ["macos"], action, versionIntroduced = "2.1.6",
    documentationLink,
    explanation
}) {
    // Derive a structured action from the fix string if one wasn't provided
    const resolvedAction = action || deriveActionFromFix(fix, category, subsystem);

    // Phase 10: Build self-explaining repair context if not provided
    const resolvedExplanation = explanation || {
        problem: description,
        impact,
        fix: fix,
        risk: RISK_LABELS[risk] || risk,
        estimatedTime: estimatedTime || "unknown",
        rollbackAvailable,
        requiresRestart
    };

    return {
        id: id || crypto.randomUUID().slice(0, 8),
        title: title || description?.slice(0, 80) || id || "Repair",
        severity,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category,
        subsystem,
        confidence,
        description,
        impact,
        fix,
        action: resolvedAction,
        risk,
        riskLabel: RISK_LABELS[risk] || risk,
        estimatedTime: estimatedTime || "unknown",
        requiresRestart,
        rollbackAvailable,
        supportsDryRun,
        platforms,
        versionIntroduced,
        documentationLink,
        explanation: resolvedExplanation,
        dependencies
    };
}

// ─── Repair Intelligence (Phase 10) ───────────────────────────────────
// explainRepair produces a human-readable, structured explanation of a
// single repair issue — Problem / Impact / Fix / Risk / Estimated Time —
// so the user always knows exactly what will happen and why.

export function explainRepair(issue) {
    const exp = issue.explanation || {};
    const action = issue.action || {};
    const lines = [];

    lines.push(`Problem`);
    lines.push(`  ${exp.problem || issue.description}`);
    lines.push("");
    lines.push(`Impact`);
    lines.push(`  ${exp.impact || issue.impact || "Unknown"}`);
    lines.push("");
    lines.push(`Fix`);
    lines.push(`  ${exp.fix || issue.fix || "No automated fix available"}`);
    lines.push("");
    lines.push(`Risk`);
    lines.push(`  ${exp.risk || issue.riskLabel || "Unknown"}`);
    lines.push("");
    lines.push(`Estimated time`);
    lines.push(`  ${exp.estimatedTime || issue.estimatedTime || "unknown"}`);
    lines.push("");

    if (action.type === ACTION_TYPES.SHELL && action.command) {
        lines.push(`Command`);
        lines.push(`  ${action.command}`);
        lines.push("");
    }
    if (action.type === ACTION_TYPES.INSTALL && action.package) {
        lines.push(`Package`);
        lines.push(`  ${action.package}`);
        lines.push("");
    }
    if (action.filesAffected && action.filesAffected.length > 0) {
        lines.push(`Files affected`);
        lines.push(`  ${action.filesAffected.join(", ")}`);
        lines.push("");
    }
    lines.push(`Rollback`);
    lines.push(`  ${issue.rollbackAvailable ? "Available" : "Not available"}`);
    if (issue.requiresRestart) {
        lines.push("");
        lines.push(`Restart required`);
        lines.push(`  Yes`);
    }
    if (issue.documentationLink) {
        lines.push("");
        lines.push(`Documentation`);
        lines.push(`  ${issue.documentationLink}`);
    }

    return lines.join("\n");
}

// explainPlan produces a full human-readable explanation of a repair plan
// including all issues, their explanations, and aggregate metadata.

export function explainPlan(plan) {
    const lines = [];
    lines.push("=" .repeat(60));
    lines.push("Repair Plan Explanation");
    lines.push("=" .repeat(60));
    lines.push("");
    lines.push(`Total repairs: ${plan.totalRepairs}`);
    lines.push(`Informational: ${plan.totalInfo}`);
    lines.push(`Estimated time: ${plan.estimatedTime}`);
    lines.push(`Risk level: ${plan.riskLabel}`);
    lines.push(`Rollback available: ${plan.rollbackAvailable ? "Yes" : "No"}`);
    if (plan.requiresRestart) lines.push(`Restart required: Yes`);
    if (plan.categoriesAffected.length > 0) {
        lines.push(`Categories: ${plan.categoriesAffected.join(", ")}`);
    }
    if (plan.filesAffected.length > 0) {
        lines.push(`Files affected: ${plan.filesAffected.join(", ")}`);
    }
    if (plan.packagesAffected.length > 0) {
        lines.push(`Packages affected: ${plan.packagesAffected.join(", ")}`);
    }
    lines.push("");

    for (let i = 0; i < plan.issues.length; i++) {
        const issue = plan.issues[i];
        lines.push(`─`.repeat(60));
        lines.push(`Repair ${i + 1} of ${plan.totalRepairs}: ${issue.title}`);
        lines.push(`─`.repeat(60));
        lines.push(explainRepair(issue));
        lines.push("");
    }

    if (plan.informational && plan.informational.length > 0) {
        lines.push(`─`.repeat(60));
        lines.push(`Informational (${plan.informational.length})`);
        lines.push(`─`.repeat(60));
        for (const info of plan.informational) {
            lines.push(`  • ${info.description}`);
            lines.push(`    Suggestion: ${info.fix}`);
        }
    }

    return lines.join("\n");
}

// deriveActionFromFix(fix, category, subsystem) — translates a legacy fix
// string into a structured action. This is the bridge that lets existing
// scanners produce structured metadata without a full rewrite.
function deriveActionFromFix(fix, category, subsystem) {
    if (!fix) return { type: ACTION_TYPES.MANUAL };
    if (category === "compatibility" && subsystem) {
        return { type: ACTION_TYPES.COMPATIBILITY, subsystem };
    }
    if (fix.startsWith("devforgekit component install ")) {
        const pkgName = fix.replace("devforgekit component install ", "").trim();
        return { type: ACTION_TYPES.INSTALL, package: pkgName };
    }
    if (fix.startsWith("git config")) {
        return { type: ACTION_TYPES.SHELL, command: fix, filesAffected: ["~/.gitconfig"] };
    }
    if (fix.startsWith("rm ")) {
        return { type: ACTION_TYPES.SHELL, command: fix, filesAffected: [fix.split(" ").slice(1).join(" ")] };
    }
    if (fix.startsWith("open -a")) {
        return { type: ACTION_TYPES.SHELL, command: fix };
    }
    if (fix.startsWith("brew ")) {
        return { type: ACTION_TYPES.SHELL, command: fix };
    }
    return { type: ACTION_TYPES.MANUAL, suggestion: fix };
}

// ─── Safety Layer (Phase 4) ───────────────────────────────────────────
// Before executing any repair, validate that the prerequisites are met.
// Each action type has its own prerequisite checks.

export async function validatePrerequisites(action) {
    const platform = getPlatform();
    const checks = [];

    // Platform support
    if (platform.id !== "macos" && action.type === ACTION_TYPES.SHELL) {
        const cmd = action.command || "";
        if (cmd.startsWith("brew ") || cmd.startsWith("open -a")) {
            checks.push({
                ok: false,
                check: "platform",
                message: `Command '${cmd.split(" ")[0]}' is not available on ${platform.id}`
            });
        }
    }

    // Package manager availability
    if (action.type === ACTION_TYPES.INSTALL || action.type === ACTION_TYPES.UNINSTALL) {
        if (action.package) {
            let pkg;
            try {
                pkg = getPackage(action.package);
            } catch {
                pkg = null;
            }
            if (!pkg) {
                checks.push({ ok: false, check: "registry", message: `Package '${action.package}' not found in registry` });
            } else {
                // Resolve through the same platformInstall lookup install()
                // itself uses (resolveInstallStep) rather than reading
                // pkg.install directly - a package whose top-level install
                // is brew-formula but whose platformInstall.linux/windows
                // entry resolves to apt/winget must not be blocked on
                // "Homebrew is not installed" on those platforms.
                const step = resolveInstallStep(pkg);
                if (step?.method?.startsWith("brew") && !(await commandExists("brew"))) {
                    checks.push({ ok: false, check: "package-manager", message: "Homebrew is not installed" });
                }
            }
        }
    }

    // Shell command prerequisite: git
    if (action.type === ACTION_TYPES.SHELL && action.command?.startsWith("git config")) {
        if (!(await commandExists("git"))) {
            checks.push({ ok: false, check: "git", message: "Git is not installed" });
        }
    }

    // Component repair prerequisite: the package must declare a repair command
    if (action.type === ACTION_TYPES.COMPONENT_REPAIR && action.package) {
        const pkg = getPackage(action.package);
        if (!pkg?.repair) {
            checks.push({ ok: false, check: "repair-command", message: `Package '${action.package}' has no repair command` });
        }
    }

    return {
        ok: checks.every((c) => c.ok),
        checks
    };
}

// ─── File backup for rollback (Phase 8) ───────────────────────────────
// Before modifying a file, back it up so the repair can be rolled back
// individually (not just via a full environment snapshot).

function backupFile(filePath) {
    if (!filePath || !existsSync(filePath)) return null;
    const backupPath = `${filePath}.repair-backup-${Date.now()}`;
    try {
        copyFileSync(filePath, backupPath);
        return backupPath;
    } catch {
        return null;
    }
}

function restoreFileBackup(backupPath, originalPath) {
    if (!backupPath || !existsSync(backupPath)) return false;
    try {
        renameSync(backupPath, originalPath);
        return true;
    } catch {
        return false;
    }
}

// ─── Scanners ─────────────────────────────────────────────────────────
// Each scanner returns an array of issues. Scanners reuse existing
// DevForgeKit subsystems for detection - they never reimplement probing
// logic.

// Scanner: Compatibility Engine
async function scanCompatibilityIssues() {
    const issues = [];
    const installed = await getInstalledPackageNames();

    let result;
    try {
        result = await scanCompatibility(installed);
    } catch {
        return issues;
    }

    for (const compatIssue of result.issues || []) {
        if (compatIssue.severity === "PASS" || compatIssue.severity === "RECOMMEND") continue;

        const severity = compatIssue.severity === "CRITICAL" ? "CRITICAL" :
            compatIssue.severity === "UNSUPPORTED" ? "CRITICAL" : "WARNING";
        const isInstall = compatIssue.recommendation?.startsWith("devforgekit component install");

        issues.push(makeIssue({
            id: `compat-${compatIssue.tool}`,
            title: `Compatibility: ${compatIssue.tool}`,
            severity,
            category: REPAIR_CATEGORIES.COMPATIBILITY,
            subsystem: compatIssue.tool,
            description: compatIssue.message,
            impact: compatIssue.severity === "CRITICAL"
                ? "Component may not function correctly"
                : "Component may have reduced functionality or stability",
            fix: compatIssue.recommendation || "Review the compatibility report for manual steps",
            estimatedTime: isInstall ? "1-2 min" : "5 min",
            rollbackAvailable: Boolean(compatIssue.recommendation),
            risk: isInstall ? RISK_LEVELS.LOW : RISK_LEVELS.MEDIUM,
            confidence: "high",
            action: isInstall
                ? { type: ACTION_TYPES.INSTALL, package: compatIssue.recommendation.replace("devforgekit component install ", "").trim() }
                : { type: ACTION_TYPES.COMPATIBILITY, subsystem: compatIssue.tool }
        }));
    }

    return issues;
}

// Scanner: PATH issues
async function scanPathIssues() {
    const issues = [];
    const pathDirs = (process.env.PATH || "").split(":").filter(Boolean);
    const seen = new Map();

    for (const dir of pathDirs) {
        if (!existsSync(dir)) {
            issues.push(makeIssue({
                id: "path-missing",
                title: `PATH: non-existent directory`,
                severity: "WARNING",
                category: REPAIR_CATEGORIES.PATH,
                subsystem: "shell",
                description: `PATH contains non-existent directory: ${dir}`,
                impact: "Commands in this directory cannot be found",
                fix: `Remove '${dir}' from your shell profile's PATH`,
                estimatedTime: "1 min",
                risk: RISK_LEVELS.LOW,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: `Remove '${dir}' from your shell profile's PATH` }
            }));
            continue;
        }
        if (seen.has(dir)) {
            issues.push(makeIssue({
                id: "path-duplicate",
                title: `PATH: duplicate entry`,
                severity: "INFO",
                category: REPAIR_CATEGORIES.PATH,
                subsystem: "shell",
                description: `Duplicate PATH entry: ${dir}`,
                impact: "Slower command resolution, potential confusion",
                fix: `Remove the duplicate '${dir}' from your PATH`,
                estimatedTime: "1 min",
                risk: RISK_LEVELS.NONE,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: `Remove the duplicate '${dir}' from your PATH` }
            }));
        }
        seen.set(dir, (seen.get(dir) || 0) + 1);
    }

    return issues;
}

// Scanner: Broken symlinks in common dev directories
async function scanBrokenSymlinks() {
    const issues = [];
    const checkDirs = getPlatform().binSearchDirs();

    for (const dir of checkDirs) {
        if (!existsSync(dir)) continue;
        try {
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isSymbolicLink()) continue;
                const linkPath = path.join(dir, entry.name);
                try {
                    statSync(linkPath);
                } catch {
                    issues.push(makeIssue({
                        id: `symlink-${dir}-${entry.name}`,
                        title: `Broken symlink: ${entry.name}`,
                        severity: "WARNING",
                        category: REPAIR_CATEGORIES.SYMLINK,
                        subsystem: "filesystem",
                        description: `Broken symlink: ${linkPath}`,
                        impact: "Command or tool referenced by this symlink is unavailable",
                        fix: `Remove broken symlink: rm ${shellQuote(linkPath)}`,
                        estimatedTime: "30 sec",
                        risk: RISK_LEVELS.LOW,
                        confidence: "high",
                        action: { type: ACTION_TYPES.SHELL, command: `rm ${shellQuote(linkPath)}`, filesAffected: [linkPath] }
                    }));
                }
            }
        } catch {
            // Permission denied or other error
        }
    }

    return issues;
}

// Scanner: Docker daemon
async function scanDockerIssues() {
    const issues = [];

    if (!(await commandExists("docker"))) return issues;

    // Check if Docker daemon is running
    const { code } = await captureShellCommand("docker info 2>/dev/null");
    if (code !== 0) {
        issues.push(makeIssue({
            id: "docker-daemon",
            title: "Docker: daemon not running",
            severity: "WARNING",
            category: REPAIR_CATEGORIES.DOCKER,
            subsystem: "docker",
            description: "Docker daemon is not running",
            impact: "Docker containers and images cannot be built or run",
            fix: "Start Docker Desktop or run: open -a Docker",
            estimatedTime: "30 sec",
            requiresRestart: false,
            risk: RISK_LEVELS.NONE,
            confidence: "high",
            action: { type: ACTION_TYPES.SHELL, command: "open -a Docker" }
        }));
    }

    return issues;
}

// Scanner: DevForgeKit CLI install health (pre-v3.0.0 "Installation
// Experience Excellence" milestone) - the global `devforgekit` symlink,
// cli/node_modules, and any Homebrew packages the last bootstrap.sh run
// recorded as failed in ~/.config/devforgekit/install-state.json
// (written by install_brewfile_per_line, scripts/common.sh). Every fix
// shells back into Layer 1 via scripts/repair_install.sh - the exact
// bash functions bootstrap.sh itself uses (install_global_command/
// ensure_cli_dependencies/install_brewfile_per_line), not a
// reimplementation in JS.
export async function scanCliInstallIssues() {
    const issues = [];
    const repairScript = scriptPath("scripts/repair_install.sh");
    const dispatcherPath = path.join(repoRoot(), "devforgekit");

    const { code: whichCode, stdout: whichOut } = await captureShellCommand("command -v devforgekit 2>/dev/null");
    let resolvedTarget = null;
    if (whichCode === 0 && whichOut.trim()) {
        const { stdout: linkOut } = await captureShellCommand(`readlink ${shellQuote(whichOut.trim())} 2>/dev/null`);
        resolvedTarget = linkOut.trim() || whichOut.trim();
    }
    if (!resolvedTarget || resolvedTarget !== dispatcherPath) {
        issues.push(makeIssue({
            id: "cli-install-symlink",
            title: "Global 'devforgekit' command is missing or stale",
            severity: "WARNING",
            category: REPAIR_CATEGORIES.CLI_INSTALL,
            subsystem: "cli-install",
            description: "'devforgekit' does not resolve to this repo's dispatcher",
            impact: "Running 'devforgekit' from outside this repo fails or runs a stale copy",
            fix: `Recreate the global command symlink: bash ${repairScript} symlink`,
            estimatedTime: "5 sec",
            risk: RISK_LEVELS.NONE,
            confidence: "high",
            action: { type: ACTION_TYPES.SHELL, command: `bash ${shellQuote(repairScript)} symlink` }
        }));
    }

    if (!existsSync(path.join(repoRoot(), "cli", "node_modules"))) {
        issues.push(makeIssue({
            id: "cli-install-deps",
            title: "DevForgeKit CLI dependencies are not installed",
            severity: "CRITICAL",
            category: REPAIR_CATEGORIES.CLI_INSTALL,
            subsystem: "cli-install",
            description: "cli/node_modules is missing",
            impact: "The root 'devforgekit' dispatcher falls back to its bash-only command set",
            fix: `Install the Node CLI's dependencies: bash ${repairScript} deps`,
            estimatedTime: "30 sec",
            risk: RISK_LEVELS.NONE,
            confidence: "high",
            action: { type: ACTION_TYPES.SHELL, command: `bash ${shellQuote(repairScript)} deps` }
        }));
    }

    const stateFile = path.join(userConfigDir(), "install-state.json");
    if (existsSync(stateFile)) {
        try {
            const state = JSON.parse(readFileSync(stateFile, "utf8"));
            const failed = Object.entries(state)
                .filter(([, v]) => typeof v === "string" && v.startsWith("failed:"))
                .map(([id]) => id);
            if (failed.length > 0) {
                issues.push(makeIssue({
                    id: "cli-install-failed-packages",
                    title: `${failed.length} package(s) failed during the last install`,
                    severity: "WARNING",
                    category: REPAIR_CATEGORIES.CLI_INSTALL,
                    subsystem: "cli-install",
                    description: `Recorded as failed in install-state.json: ${failed.join(", ")}`,
                    impact: "These packages were never successfully installed",
                    fix: `Retry the failed package(s): bash ${repairScript} packages`,
                    estimatedTime: "1-5 min",
                    risk: RISK_LEVELS.LOW,
                    confidence: "high",
                    action: { type: ACTION_TYPES.SHELL, command: `bash ${shellQuote(repairScript)} packages` }
                }));
            }
        } catch {
            // Malformed state file isn't itself a repairable issue here -
            // a fresh bootstrap.sh run overwrites it via install_state_reset.
        }
    }

    return issues;
}

// Scanner: Disk space
async function scanDiskIssues() {
    const issues = [];

    try {
        const { stdout } = await captureShellCommand("df -Pk / 2>/dev/null");
        const line = stdout.trim().split("\n")[1] || "";
        const usedPercent = Number((line.trim().split(/\s+/)[4] || "0").replace("%", "")) || 0;

        if (usedPercent > 90) {
            issues.push(makeIssue({
                id: "disk-space",
                title: `Disk space: ${usedPercent}% used`,
                severity: usedPercent > 95 ? "CRITICAL" : "WARNING",
                category: REPAIR_CATEGORIES.DISK,
                subsystem: "filesystem",
                description: `Disk usage at ${usedPercent}%`,
                impact: usedPercent > 95 ? "System may become unresponsive" : "Low disk space may cause failures",
                fix: "Run 'devforgekit clean' to reclaim disk space, or remove large files",
                estimatedTime: "5 min",
                risk: RISK_LEVELS.LOW,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: "Run 'devforgekit clean' to reclaim disk space, or remove large files" }
            }));
        }
    } catch {
        // Non-critical
    }

    return issues;
}

// Scanner: Git configuration
async function scanGitIssues() {
    const issues = [];

    const { code: nameCode, stdout: nameOut } = await captureShellCommand("git config user.name 2>/dev/null");
    if (nameCode !== 0 || !nameOut.trim()) {
        issues.push(makeIssue({
            id: "git-name",
            title: "Git: user.name not set",
            severity: "WARNING",
            category: REPAIR_CATEGORIES.GIT,
            subsystem: "git",
            description: "Git user.name is not set",
            impact: "Commits will fail or use a fallback identity",
            fix: "git config --global user.name 'Your Name'",
            estimatedTime: "30 sec",
            risk: RISK_LEVELS.LOW,
            confidence: "high",
            action: { type: ACTION_TYPES.SHELL, command: "git config --global user.name 'Your Name'", filesAffected: ["~/.gitconfig"] }
        }));
    }

    const { code: emailCode, stdout: emailOut } = await captureShellCommand("git config user.email 2>/dev/null");
    if (emailCode !== 0 || !emailOut.trim()) {
        issues.push(makeIssue({
            id: "git-email",
            title: "Git: user.email not set",
            severity: "WARNING",
            category: REPAIR_CATEGORIES.GIT,
            subsystem: "git",
            description: "Git user.email is not set",
            impact: "Commits will fail or use a fallback identity",
            fix: "git config --global user.email 'you@example.com'",
            estimatedTime: "30 sec",
            risk: RISK_LEVELS.LOW,
            confidence: "high",
            action: { type: ACTION_TYPES.SHELL, command: "git config --global user.email 'you@example.com'", filesAffected: ["~/.gitconfig"] }
        }));
    }

    return issues;
}

// Scanner: Workspace validation
async function scanWorkspaceIssues() {
    const issues = [];

    for (const ws of listWorkspaces()) {
        if (!ws.valid) {
            issues.push(makeIssue({
                id: `workspace-${ws.name}`,
                title: `Workspace: ${ws.name} invalid`,
                severity: "WARNING",
                category: REPAIR_CATEGORIES.WORKSPACE,
                subsystem: "workspace-manager",
                description: `Workspace '${ws.name}' is invalid: ${ws.error || "unknown error"}`,
                impact: "Workspace cannot be activated or used",
                fix: `Review workspace '${ws.name}' configuration or remove it: devforgekit workspace delete ${ws.name}`,
                estimatedTime: "2 min",
                risk: RISK_LEVELS.MEDIUM,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: `Review workspace '${ws.name}' configuration or remove it: devforgekit workspace delete ${ws.name}` }
            }));
        }
    }

    return issues;
}

// Scanner: Plugin validation
async function scanPluginIssues() {
    const issues = [];

    let plugins;
    try {
        plugins = discoverPlugins();
    } catch {
        return issues;
    }

    for (const plugin of plugins) {
        if (!plugin.valid) {
            issues.push(makeIssue({
                id: `plugin-${plugin.name}`,
                title: `Plugin: ${plugin.name} invalid`,
                severity: "WARNING",
                category: REPAIR_CATEGORIES.PLUGINS,
                subsystem: "plugins",
                description: `Plugin '${plugin.name}' failed validation: ${plugin.error || "unknown error"}`,
                impact: "Plugin commands and hooks will not be available",
                fix: `Review plugin '${plugin.name}' manifest or remove the plugin directory`,
                estimatedTime: "5 min",
                risk: RISK_LEVELS.MEDIUM,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: `Review plugin '${plugin.name}' manifest or remove the plugin directory` }
            }));
        }
    }

    return issues;
}

// Scanner: Configuration validation
async function scanConfigIssues() {
    const issues = [];
    const config = loadConfig();

    // Check for invalid AI provider
    if (config.aiProvider && config.aiProvider !== "none") {
        const { KNOWN_PROVIDERS } = await import("./ai/providers/index.js");
        if (!KNOWN_PROVIDERS.includes(config.aiProvider)) {
            issues.push(makeIssue({
                id: "config-ai-provider",
                title: `Config: invalid AI provider`,
                severity: "WARNING",
                category: REPAIR_CATEGORIES.AI,
                subsystem: "config",
                description: `Unknown AI provider '${config.aiProvider}' in configuration`,
                impact: "AI commands will fail to resolve a provider",
                fix: `devforgekit config set aiProvider <${KNOWN_PROVIDERS.join("|")}>`,
                estimatedTime: "1 min",
                risk: RISK_LEVELS.LOW,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: `devforgekit config set aiProvider <${KNOWN_PROVIDERS.join("|")}>` }
            }));
        }
    }

    return issues;
}

// Scanner: Homebrew health
async function scanHomebrewIssues() {
    const issues = [];

    if (!(await commandExists("brew"))) return issues;

    // Check brew doctor
    const { code, stdout } = await captureShellCommand("brew doctor 2>/dev/null");
    if (code !== 0 && stdout.trim()) {
        const lines = stdout.trim().split("\n").filter((l) => l.trim());
        if (lines.length > 0) {
            issues.push(makeIssue({
                id: "brew-doctor",
                title: "Homebrew: doctor reports issues",
                severity: "WARNING",
                category: REPAIR_CATEGORIES.HOMEBREW,
                subsystem: "homebrew",
                description: `Homebrew reports issues: ${lines[0].slice(0, 100)}`,
                impact: "Package installation or updates may fail",
                fix: "Run 'brew doctor' for details and follow the recommended fixes",
                estimatedTime: "10 min",
                risk: RISK_LEVELS.MEDIUM,
                confidence: "high",
                action: { type: ACTION_TYPES.MANUAL, suggestion: "Run 'brew doctor' for details and follow the recommended fixes" }
            }));
        }
    }

    return issues;
}

// Scanner: SSH key check
async function scanSSHIssues() {
    const issues = [];
    const sshDir = path.join(homeDir(), ".ssh");

    if (!existsSync(sshDir)) {
        issues.push(makeIssue({
            id: "ssh-no-keys",
            title: "SSH: no keys found",
            severity: "INFO",
            category: REPAIR_CATEGORIES.SSH,
            subsystem: "ssh",
            description: "No SSH directory found",
            impact: "Git over SSH and remote access will not work",
            fix: "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
            estimatedTime: "2 min",
            risk: RISK_LEVELS.LOW,
            confidence: "high",
            action: { type: ACTION_TYPES.MANUAL, suggestion: "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'" }
        }));
        return issues;
    }

    const keys = readdirSync(sshDir).filter((f) => f.startsWith("id_") && !f.endsWith(".pub"));
    if (keys.length === 0) {
        issues.push(makeIssue({
            id: "ssh-no-keys",
            title: "SSH: no keys found",
            severity: "INFO",
            category: REPAIR_CATEGORIES.SSH,
            subsystem: "ssh",
            description: "No SSH private keys found in ~/.ssh/",
            impact: "Git over SSH and remote access will not work",
            fix: "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'",
            estimatedTime: "2 min",
            risk: RISK_LEVELS.LOW,
            confidence: "high",
            action: { type: ACTION_TYPES.MANUAL, suggestion: "Generate an SSH key: ssh-keygen -t ed25519 -C 'your_email@example.com'" }
        }));
    }

    return issues;
}

// Scanner: Orphaned caches
async function scanCacheIssues() {
    const issues = [];
    const home = homeDir();

    const cacheDirs = [
        { path: path.join(home, "Library", "Caches", "Homebrew"), label: "Homebrew cache", maxGb: 5, platforms: ["macos"] },
        { path: path.join(home, ".npm", "_cacache"), label: "npm cache", maxGb: 2, platforms: ["macos", "linux", "windows"] },
        { path: path.join(home, ".cache"), label: "General cache", maxGb: 5, platforms: ["macos", "linux"] }
    ];

    for (const { path: cachePath, label, maxGb } of cacheDirs) {
        if (!existsSync(cachePath)) continue;
        try {
            const { stdout } = await captureShellCommand(`du -sk ${shellQuote(cachePath)} 2>/dev/null`);
            const sizeKb = Number(stdout.trim().split(/\s+/)[0] || 0);
            const sizeGb = sizeKb / 1024 / 1024;
            if (sizeGb > maxGb) {
                issues.push(makeIssue({
                    id: `cache-${label.toLowerCase().replace(/\s/g, "-")}`,
                    title: `Cache: ${label} oversized`,
                    severity: "INFO",
                    category: REPAIR_CATEGORIES.CACHE,
                    subsystem: "filesystem",
                    description: `${label} is ${sizeGb.toFixed(1)} GB (>${maxGb} GB threshold)`,
                    impact: "Excessive disk usage from cached files",
                    fix: `Clear cache: rm -rf ${shellQuote(cachePath)}`,
                    estimatedTime: "1 min",
                    risk: RISK_LEVELS.LOW,
                    confidence: "high",
                    action: { type: ACTION_TYPES.SHELL, command: `rm -rf ${shellQuote(cachePath)}`, filesAffected: [cachePath] }
                }));
            }
        } catch {
            // Non-critical
        }
    }

    return issues;
}

// ─── Scanner Registry ─────────────────────────────────────────────────

const SCANNERS = [
    { name: "compatibility", run: scanCompatibilityIssues, label: "Compatibility Engine" },
    { name: "path", run: scanPathIssues, label: "PATH" },
    { name: "symlinks", run: scanBrokenSymlinks, label: "Broken Symlinks" },
    { name: "docker", run: scanDockerIssues, label: "Docker" },
    { name: "disk", run: scanDiskIssues, label: "Disk Space" },
    { name: "git", run: scanGitIssues, label: "Git Configuration" },
    { name: "workspaces", run: scanWorkspaceIssues, label: "Workspaces" },
    { name: "plugins", run: scanPluginIssues, label: "Plugins" },
    { name: "config", run: scanConfigIssues, label: "Configuration" },
    { name: "homebrew", run: scanHomebrewIssues, label: "Homebrew" },
    { name: "ssh", run: scanSSHIssues, label: "SSH" },
    { name: "cache", run: scanCacheIssues, label: "Caches" },
    { name: "cli-install", run: scanCliInstallIssues, label: "CLI Install" }
];

// ─── Scan ─────────────────────────────────────────────────────────────

// scanIssues({ onProgress, silent }) -> issues[]. `silent: true` (every
// --json caller in commands/repair.js passes this) suppresses every
// logger.* call this function makes - info/success/section go to
// stdout via console.log (see logger.js), and with no gate here they
// used to land directly in the middle of a --json command's JSON
// output, corrupting it for any script/jq consumer. onProgress still
// fires either way, so the TUI's live progress display (which renders
// its own UI rather than reading stdout text) is unaffected.
export async function scanIssues({ onProgress, silent = false } = {}) {
    const log = silent ? { section() {}, info() {}, success() {}, warn() {} } : logger;
    log.section("Repair Engine: Scan");
    log.info(`Running ${SCANNERS.length} scanners...\n`);

    const allIssues = [];

    for (let i = 0; i < SCANNERS.length; i++) {
        const scanner = SCANNERS[i];
        if (onProgress) onProgress({ scanner: scanner.name, label: scanner.label, index: i, total: SCANNERS.length, status: "running" });

        try {
            const issues = await scanner.run();
            allIssues.push(...issues);
            const critical = issues.filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL").length;
            const warnings = issues.filter((i) => i.severity === "WARNING").length;
            const info = issues.filter((i) => i.severity === "INFO").length;

            if (issues.length === 0) {
                log.success(`  ${scanner.label}: OK`);
            } else {
                log.warn(`  ${scanner.label}: ${issues.length} issue(s) (${critical} critical, ${warnings} warning, ${info} info)`);
            }

            if (onProgress) onProgress({ scanner: scanner.name, label: scanner.label, index: i, total: SCANNERS.length, status: "done", count: issues.length });
        } catch (err) {
            log.warn(`  ${scanner.label}: scanner error - ${err.message}`);
            if (onProgress) onProgress({ scanner: scanner.name, label: scanner.label, index: i, total: SCANNERS.length, status: "error", error: err.message });
        }
    }

    // Sort by severity
    allIssues.sort((a, b) => (SEVERITY_ORDER[a.severity] || 99) - (SEVERITY_ORDER[b.severity] || 99));

    log.section("Scan Complete");
    const critical = allIssues.filter((i) => i.severity === "CRITICAL" || i.severity === "FATAL").length;
    const warnings = allIssues.filter((i) => i.severity === "WARNING").length;
    const info = allIssues.filter((i) => i.severity === "INFO").length;
    log.info(`Found ${allIssues.length} issue(s): ${critical} critical, ${warnings} warning, ${info} info`);

    return allIssues;
}

// ─── Plan ─────────────────────────────────────────────────────────────

// ─── Plan (Phase 6: Repair Plans) ────────────────────────────────────
// planRepairs now computes risk level, categories affected, and structured
// summary for the confirmation prompt.

export function planRepairs(issues) {
    const repairable = issues.filter((i) => i.fix && i.severity !== "INFO");
    const informational = issues.filter((i) => i.severity === "INFO");

    // Build dependency graph and topologically sort
    const issueMap = new Map(repairable.map((i) => [i.id, i]));
    const visited = new Set();
    const ordered = [];

    function visit(issueId, stack = new Set()) {
        if (visited.has(issueId)) return;
        if (stack.has(issueId)) return; // Cycle protection
        const issue = issueMap.get(issueId);
        if (!issue) return;

        stack.add(issueId);
        for (const depId of issue.dependencies || []) {
            visit(depId, stack);
        }
        stack.delete(issueId);
        visited.add(issueId);
        ordered.push(issue);
    }

    // Sort by severity first, then visit
    repairable.sort((a, b) => (SEVERITY_ORDER[a.severity] || 99) - (SEVERITY_ORDER[b.severity] || 99));
    for (const issue of repairable) {
        visit(issue.id);
    }

    // Parse estimated time: supports "N sec", "N min", "N-N min" formats
    const totalSeconds = ordered.reduce((acc, issue) => {
        const t = issue.estimatedTime || "";
        const secMatch = t.match(/(\d+)\s*sec/);
        const minMatch = t.match(/(\d+)\s*min/);
        if (secMatch) return acc + parseInt(secMatch[1], 10);
        if (minMatch) return acc + parseInt(minMatch[1], 10) * 60;
        return acc;
    }, 0);
    const totalEstimatedTime = totalSeconds >= 60
        ? `${Math.ceil(totalSeconds / 60)} min`
        : `${totalSeconds} sec`;

    const requiresRestart = ordered.some((i) => i.requiresRestart);

    // Phase 6: Compute aggregate risk level
    const maxRisk = ordered.reduce((max, issue) => {
        const r = RISK_ORDER[issue.risk] || 0;
        return r > max ? r : max;
    }, 0);
    const riskLevel = Object.entries(RISK_ORDER).find(([, v]) => v === maxRisk)?.[0] || RISK_LEVELS.NONE;

    // Phase 6: Collect categories affected
    const categoriesAffected = [...new Set(ordered.map((i) => i.categoryLabel))];

    // Phase 6: Collect files affected
    const filesAffected = [...new Set(ordered.flatMap((i) => i.action?.filesAffected || []))];

    // Phase 6: Collect packages affected
    const packagesAffected = [...new Set(ordered
        .map((i) => i.action?.package)
        .filter(Boolean))];

    // Phase 4 fix: rollbackAvailable should be per-issue, not all-or-nothing
    const rollbackIssues = ordered.filter((i) => !i.rollbackAvailable);
    const rollbackAvailable = ordered.every((i) => i.rollbackAvailable);

    return {
        issues: ordered,
        informational,
        totalRepairs: ordered.length,
        totalInfo: informational.length,
        estimatedTime: totalEstimatedTime,
        estimatedTimeSeconds: totalSeconds,
        requiresRestart,
        rollbackAvailable,
        rollbackUnavailableCount: rollbackIssues.length,
        rollbackUnavailableIssues: rollbackIssues.map((i) => i.id),
        riskLevel,
        riskLabel: RISK_LABELS[riskLevel] || riskLevel,
        categoriesAffected,
        filesAffected,
        packagesAffected
    };
}

// ─── Execute (Phase 4: Safety, Phase 7: Progress, Phase 8: Rollback) ──

export async function executeRepairs(plan, { assumeYes = false, onProgress, rollbackSnapshot, dryRun = false, silent = false } = {}) {
    const log = silent ? { section() {}, info() {}, success() {}, warn() {}, error() {} } : logger;
    const print = silent ? () => {} : (...args) => console.log(...args);
    if (dryRun) return dryRunPlan(plan);

    log.section("Repair Engine: Execute");
    log.info(`Executing ${plan.totalRepairs} repair(s)...`);
    log.info(`Risk: ${plan.riskLabel} | Estimated time: ${plan.estimatedTime}`);
    if (plan.rollbackUnavailableCount > 0) {
        log.warn(`${plan.rollbackUnavailableCount} repair(s) cannot be rolled back`);
    }
    if (plan.requiresRestart) log.warn("Some repairs require a restart");
    print("");

    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < plan.issues.length; i++) {
        const issue = plan.issues[i];
        const repairStartTime = Date.now();

        // Phase 7: Visual progress bar
        const progressPct = Math.round((i / plan.totalRepairs) * 100);
        const barWidth = 20;
        const filled = Math.round((progressPct / 100) * barWidth);
        const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
        const elapsedS = Math.round((Date.now() - startTime) / 1000);
        const avgPerRepair = i > 0 ? elapsedS / i : 0;
        const remainingS = Math.round(avgPerRepair * (plan.totalRepairs - i));
        print(`  Repair ${i + 1} of ${plan.totalRepairs}: ${issue.title}`);
        print(`  ${bar} ${progressPct}%  Elapsed: ${elapsedS}s  Remaining: ~${remainingS}s`);
        print("");

        if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "starting", title: issue.title, progressPct, elapsedS, remainingS });

        // Phase 4: Validate prerequisites before attempting repair
        const prereq = await validatePrerequisites(issue.action);
        if (!prereq.ok) {
            const messages = prereq.checks.filter((c) => !c.ok).map((c) => c.message);
            log.warn(`  ⚠ Skipping: ${issue.description} - prerequisite: ${messages.join(", ")}`);
            results.push({ issue, ok: false, skipped: true, reason: "prerequisites", checks: prereq.checks });
            if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "skipped", reason: "prerequisites" });
            print("");
            continue;
        }

        // Phase 10: Rich confirmation with full explanation
        if (!assumeYes) {
            const confirmMsg = [
                `  Problem:  ${issue.description}`,
                `  Impact:   ${issue.impact}`,
                `  Fix:      ${issue.fix}`,
                `  Risk:     ${issue.riskLabel}`,
                `  Time:     ${issue.estimatedTime}`,
                `  Rollback: ${issue.rollbackAvailable ? "Available" : "Not available"}`,
                ``,
                `  Proceed with this repair?`
            ].join("\n");
            const shouldFix = await confirm(confirmMsg, false);
            if (!shouldFix) {
                log.info(`  Skipped: ${issue.description}`);
                results.push({ issue, ok: false, skipped: true });
                if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "skipped" });
                print("");
                continue;
            }
        }

        log.info(`  Repairing: ${issue.description}`);
        if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "repairing", title: issue.title });

        // Phase 8: Per-repair file backup for rollback
        const fileBackups = {};
        if (issue.action?.filesAffected) {
            for (const filePath of issue.action.filesAffected) {
                const expanded = filePath.replace("~/", homeDir() + "/").replace("$HOME", homeDir());
                const backup = backupFile(expanded);
                if (backup) fileBackups[expanded] = backup;
            }
        }

        try {
            const repairResult = await executeRepairAction(issue);
            const elapsedMs = Date.now() - repairStartTime;
            results.push({ issue, ...repairResult, elapsedMs, fileBackups });

            if (repairResult.ok) {
                log.success(`  ✓ Fixed: ${issue.description} (${(elapsedMs / 1000).toFixed(1)}s)`);
                if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "done", ok: true, elapsedMs });
            } else {
                log.warn(`  ✗ Could not fix: ${issue.description} - ${repairResult.error || "unknown"}`);
                if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "done", ok: false, error: repairResult.error, elapsedMs });
            }
        } catch (err) {
            const elapsedMs = Date.now() - repairStartTime;
            results.push({ issue, ok: false, error: err.message, elapsedMs, fileBackups });
            log.error(`  ✗ Failed: ${issue.description} - ${err.message}`);
            if (onProgress) onProgress({ issue, index: i, total: plan.totalRepairs, status: "error", error: err.message, elapsedMs });
        }
        print("");
    }

    // Phase 7: Final progress summary
    const totalElapsedS = Math.round((Date.now() - startTime) / 1000);
    const fixed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const filesModified = results.filter((r) => r.ok && r.fileBackups && Object.keys(r.fileBackups).length > 0).length;
    const rollbackAvailable = results.some((r) => r.fileBackups && Object.keys(r.fileBackups).length > 0);

    log.section("Repairs Complete");
    print(`  ✓ Fixed:          ${fixed}`);
    print(`  ✗ Failed:         ${failed}`);
    print(`  ⚠ Skipped:        ${skipped}`);
    print(`  📁 Files modified: ${filesModified}`);
    print(`  ↩ Rollback:       ${rollbackAvailable ? "Available" : "Not available"}`);
    print(`  ⏱ Duration:       ${totalElapsedS}s`);

    return { results, fixed, failed, skipped, filesModified, rollbackAvailable, rollbackSnapshot, durationMs: Date.now() - startTime };
}

// executeRepairAction now routes via the structured action (issue.action),
// not by string-matching the fix field. This eliminates the unsafe
// `fix.startsWith("rm ")` pattern that could execute arbitrary rm commands.
async function executeRepairAction(issue) {
    const action = issue.action || { type: ACTION_TYPES.MANUAL };

    // Compatibility repairs - reuse compatibility/repair.js
    if (action.type === ACTION_TYPES.COMPATIBILITY) {
        const installed = await getInstalledPackageNames();
        const scanResult = await scanCompatibility(installed);
        const actions = planCompatRepair(scanResult);
        const relevantActions = actions.filter((a) => a.tool === action.subsystem || a.name === action.subsystem);
        if (relevantActions.length > 0) {
            const repairResults = await executeCompatRepair(relevantActions, { assumeYes: true });
            const allOk = repairResults.every((r) => r.ok);
            return { ok: allOk, details: repairResults };
        }
        return { ok: false, manual: true, error: "No compatible repair action found" };
    }

    // Package install repairs
    if (action.type === ACTION_TYPES.INSTALL && action.package) {
        try {
            const pkg = getPackage(action.package);
            if (pkg) {
                const code = await install(pkg, undefined, { silent: true });
                return { ok: code === 0, exitCode: code };
            }
            return { ok: false, error: `Package '${action.package}' not found in registry` };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // Component repair (registry-declared repair command)
    if (action.type === ACTION_TYPES.COMPONENT_REPAIR && action.package) {
        try {
            const pkg = getPackage(action.package);
            if (pkg?.repair) {
                const code = await runShellCommand(pkg.repair, { silent: true });
                return { ok: code === 0, exitCode: code };
            }
            return { ok: false, error: `Package '${action.package}' has no repair command` };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    // Shell command repairs (structured, not string-matched from fix)
    if (action.type === ACTION_TYPES.SHELL && action.command) {
        const code = await runShellCommand(action.command, { silent: true });
        return { ok: code === 0, exitCode: code };
    }

    // For repairs we can't automate, return as manual
    return { ok: false, manual: true, error: "Manual intervention required" };
}

// ─── Verify ───────────────────────────────────────────────────────────

export async function verifyRepairs({ runBenchmark: runBench = false, silent = false } = {}) {
    const log = silent ? { section() {}, info() {}, success() {}, warn() {} } : logger;
    log.section("Repair Engine: Verify");

    const results = [];

    // 1. Compatibility check
    log.info("Running compatibility scan...");
    try {
        const installed = await getInstalledPackageNames();
        const compatResult = await scanCompatibility(installed);
        results.push({
            check: "Compatibility",
            status: compatResult.critical === 0 ? "PASS" : "FAIL",
            score: compatResult.score,
            verdict: compatResult.verdict,
            critical: compatResult.critical,
            warnings: compatResult.warn
        });
        log.success(`  Compatibility: ${compatResult.score}% - ${compatResult.verdict}`);
    } catch (err) {
        results.push({ check: "Compatibility", status: "WARNING", error: err.message });
        log.warn(`  Compatibility: could not run - ${err.message}`);
    }

    // 2. Health score
    log.info("Calculating health score...");
    try {
        const installResults = [];
        for (const pkg of loadPackages()) {
            if (!pkg.validate) continue;
            try {
                installResults.push({ status: (await validate(pkg)) === 0 ? "PASS" : "WARNING", name: pkg.name });
            } catch {
                installResults.push({ status: "WARNING", name: pkg.name });
            }
        }
        const health = scoreResults(installResults);
        results.push({
            check: "Health Score",
            status: health.score >= 70 ? "PASS" : "FAIL",
            score: health.score,
            verdict: health.verdict
        });
        log.success(`  Health: ${health.score}% - ${health.verdict}`);
    } catch (err) {
        results.push({ check: "Health Score", status: "WARNING", error: err.message });
        log.warn(`  Health: could not calculate - ${err.message}`);
    }

    // 3. Workspace validation
    log.info("Validating workspaces...");
    try {
        const workspaces = listWorkspaces();
        const invalid = workspaces.filter((w) => !w.valid);
        results.push({
            check: "Workspaces",
            status: invalid.length === 0 ? "PASS" : "WARNING",
            total: workspaces.length,
            invalid: invalid.length
        });
        log.success(`  Workspaces: ${workspaces.length - invalid.length}/${workspaces.length} valid`);
    } catch (err) {
        results.push({ check: "Workspaces", status: "WARNING", error: err.message });
        log.warn(`  Workspaces: could not validate - ${err.message}`);
    }

    // 4. Plugin validation
    log.info("Validating plugins...");
    try {
        const plugins = discoverPlugins();
        const invalid = plugins.filter((p) => !p.valid);
        results.push({
            check: "Plugins",
            status: invalid.length === 0 ? "PASS" : "WARNING",
            total: plugins.length,
            invalid: invalid.length
        });
        log.success(`  Plugins: ${plugins.length - invalid.length}/${plugins.length} valid`);
    } catch (err) {
        results.push({ check: "Plugins", status: "WARNING", error: err.message });
        log.warn(`  Plugins: could not validate - ${err.message}`);
    }

    // 5. Config validation
    log.info("Validating configuration...");
    try {
        const config = loadConfig();
        const { KNOWN_PROVIDERS } = await import("./ai/providers/index.js");
        const configOk = !config.aiProvider || ["none", ...KNOWN_PROVIDERS].includes(config.aiProvider);
        results.push({
            check: "Configuration",
            status: configOk ? "PASS" : "WARNING"
        });
        log.success(`  Configuration: ${configOk ? "valid" : "issues found"}`);
    } catch (err) {
        results.push({ check: "Configuration", status: "WARNING", error: err.message });
        log.warn(`  Configuration: could not validate - ${err.message}`);
    }

    // 6. Benchmark (optional)
    if (runBench) {
        log.info("Running quick benchmark...");
        try {
            const { runBenchmark: benchRun } = await import("./benchmark.js");
            const benchResult = await benchRun({ profile: "quick" });
            results.push({
                check: "Benchmark",
                status: "PASS",
                score: benchResult.overallScore,
                grade: benchResult.overallGrade
            });
            log.success(`  Benchmark: ${benchResult.overallScore}/100 (${benchResult.overallGrade})`);
        } catch (err) {
            results.push({ check: "Benchmark", status: "WARNING", error: err.message });
            log.warn(`  Benchmark: could not run - ${err.message}`);
        }
    }

    // Summary
    const healthResults = results.map((r) => ({ status: r.status }));
    const health = scoreResults(healthResults);
    log.section("Verification Complete");
    log.success(`Overall: ${health.score}% - ${health.verdict}`);

    return { results, health };
}

// ─── Rollback (Phase 8: Per-repair rollback) ─────────────────────────

export async function createRollbackPoint() {
    logger.info("Creating rollback snapshot...");
    try {
        const { createSnapshot } = await import("./snapshot.js");
        const snapshot = await createSnapshot({ skipInventory: true });
        logger.success(`Rollback snapshot created: ${snapshot.id}`);
        return snapshot;
    } catch (err) {
        logger.warn(`Could not create rollback snapshot: ${err.message}`);
        return null;
    }
}

// rollbackRepairResult: rolls back a single repair result by restoring
// file backups created during execution. This is per-repair granularity,
// complementing the full environment snapshot rollback.
export function rollbackRepairResult(result) {
    if (!result?.fileBackups) return { ok: false, error: "No file backups for this repair" };
    const restored = [];
    for (const [originalPath, backupPath] of Object.entries(result.fileBackups)) {
        if (restoreFileBackup(backupPath, originalPath)) {
            restored.push(originalPath);
        }
    }
    return { ok: restored.length > 0, restored };
}

// Phase 8: listRollbackPoints — lists all repair records that have
// rollback snapshots or per-repair file backups available.
export function listRollbackPoints() {
    const history = listHistory();
    return history
        .filter((h) => h.rollbackSnapshotId || h.fixed > 0)
        .map((h) => ({
            id: h.id,
            createdAt: h.createdAt,
            rollbackSnapshotId: h.rollbackSnapshotId,
            fixed: h.fixed,
            failed: h.failed,
            skipped: h.skipped,
            riskLevel: h.riskLevel,
            qualityScore: h.qualityScore,
            issueCount: h.issueCount
        }));
}

// Phase 8: previewRollback — shows what would be restored without
// actually performing the rollback. Returns a structured preview.
export function previewRollback(repairId) {
    const record = getRepairRecord(repairId);
    const preview = {
        repairId: record.id,
        createdAt: record.createdAt,
        rollbackSnapshotId: record.rollbackSnapshotId || null,
        hasSnapshot: Boolean(record.rollbackSnapshotId),
        fileBackups: [],
        repairsReversible: 0,
        repairsIrreversible: 0
    };

    for (const result of record.repairResults || []) {
        if (result.fileBackups && Object.keys(result.fileBackups).length > 0) {
            preview.repairsReversible++;
            for (const [originalPath, backupPath] of Object.entries(result.fileBackups)) {
                preview.fileBackups.push({
                    originalPath,
                    backupPath,
                    backupExists: existsSync(backupPath),
                    issue: result.issue?.title || result.issue?.description || "unknown"
                });
            }
        } else if (result.ok) {
            preview.repairsIrreversible++;
        }
    }

    return preview;
}

// Phase 8: rollbackRepair — rolls back a specific repair record by
// restoring file backups. Optionally uses the full snapshot if available.
export async function rollbackRepair(repairId, { useSnapshot = false, assumeYes = false } = {}) {
    const record = getRepairRecord(repairId);
    const preview = previewRollback(repairId);

    logger.section(`Repair Engine: Rollback ${repairId}`);
    logger.info(`Created: ${record.createdAt}`);
    logger.info(`Fixed: ${record.fixed}, Failed: ${record.failed}, Skipped: ${record.skipped}`);

    if (useSnapshot && record.rollbackSnapshotId) {
        logger.info(`Using full snapshot: ${record.rollbackSnapshotId}`);
        return rollback(record.rollbackSnapshotId);
    }

    if (preview.fileBackups.length === 0) {
        logger.warn("No file backups available for this repair record.");
        if (record.rollbackSnapshotId) {
            logger.info(`A full snapshot is available: ${record.rollbackSnapshotId}`);
            logger.info("Use 'devforgekit repair rollback " + record.rollbackSnapshotId + "' for full rollback.");
        }
        return { ok: false, error: "No file backups available" };
    }

    logger.info(`\n  Files to restore:`);
    for (const fb of preview.fileBackups) {
        const status = fb.backupExists ? "✓" : "✗";
        logger.info(`  ${status} ${fb.originalPath}`);
    }
    logger.info(`\n  Repairs reversible: ${preview.repairsReversible}`);
    logger.info(`  Repairs irreversible: ${preview.repairsIrreversible}`);

    if (!assumeYes) {
        const shouldProceed = await confirm("\nProceed with rollback?", false);
        if (!shouldProceed) {
            logger.info("Rollback cancelled");
            return { ok: false, cancelled: true };
        }
    }

    const restored = [];
    const failed = [];
    for (const result of record.repairResults || []) {
        if (!result.fileBackups) continue;
        for (const [originalPath, backupPath] of Object.entries(result.fileBackups)) {
            if (restoreFileBackup(backupPath, originalPath)) {
                restored.push(originalPath);
            } else {
                failed.push(originalPath);
            }
        }
    }

    if (restored.length > 0) {
        logger.success(`Restored ${restored.length} file(s)`);
    }
    if (failed.length > 0) {
        logger.error(`Failed to restore ${failed.length} file(s)`);
    }

    return { ok: restored.length > 0, restored, failed };
}

export async function rollback(rollbackSnapshotId) {
    if (!rollbackSnapshotId) {
        throw new DevForgeError("No rollback snapshot ID provided");
    }

    logger.section("Repair Engine: Rollback");
    logger.info(`Rolling back to snapshot ${rollbackSnapshotId}...`);

    try {
        const { restoreSnapshot } = await import("./snapshot.js");
        const { snapshotsDir } = await import("./snapshot.js");
        const snapshotPath = path.join(snapshotsDir(), `${rollbackSnapshotId}.dfk`);

        if (!existsSync(snapshotPath)) {
            throw new DevForgeError(`Rollback snapshot '${rollbackSnapshotId}' not found at ${snapshotPath}`);
        }

        const result = await restoreSnapshot(snapshotPath, { skipPackages: true, force: true });

        if (result.ok) {
            logger.success("Rollback complete");
        } else {
            logger.error(`Rollback failed: ${result.error}`);
        }

        return result;
    } catch (err) {
        logger.error(`Rollback failed: ${err.message}`);
        throw err;
    }
}

// ─── History (Phase 9: Enhanced history) ─────────────────────────────

export function saveRepairRecord(record) {
    const dir = repairsDir();
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${record.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
    return filePath;
}

export function listHistory({ filter, search, limit, sortBy = "date", sortOrder = "desc" } = {}) {
    const dir = repairsDir();
    if (!existsSync(dir)) return [];

    const records = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        try {
            const data = JSON.parse(readFileSync(filePath, "utf8"));
            records.push({
                id: data.id,
                createdAt: data.createdAt,
                issueCount: data.issues?.length || 0,
                fixed: data.fixed || 0,
                failed: data.failed || 0,
                skipped: data.skipped || 0,
                durationMs: data.durationMs || 0,
                machine: data.machine?.hostname || "unknown",
                platform: data.machine?.platform || "unknown",
                user: data.machine?.user || "unknown",
                riskLevel: data.plan?.riskLevel || "unknown",
                riskLabel: data.plan?.riskLabel || "unknown",
                rollbackSnapshotId: data.rollbackSnapshotId || null,
                categoriesAffected: data.plan?.categoriesAffected || [],
                qualityScore: data.qualityScore || null,
                path: filePath
            });
        } catch {
            // Corrupt file
        }
    }

    // Phase 9: Filter by category, risk, or status
    let filtered = records;
    if (filter) {
        if (filter.category) {
            filtered = filtered.filter((r) => r.categoriesAffected.includes(filter.category));
        }
        if (filter.risk) {
            filtered = filtered.filter((r) => r.riskLevel === filter.risk);
        }
        if (filter.status) {
            if (filter.status === "success") filtered = filtered.filter((r) => r.failed === 0 && r.fixed > 0);
            if (filter.status === "failed") filtered = filtered.filter((r) => r.failed > 0);
            if (filter.status === "partial") filtered = filtered.filter((r) => r.failed > 0 && r.fixed > 0);
        }
    }

    // Phase 9: Search across id, categories, machine
    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((r) =>
            r.id.toLowerCase().includes(q) ||
            r.machine.toLowerCase().includes(q) ||
            r.platform.toLowerCase().includes(q) ||
            r.categoriesAffected.some((c) => c.toLowerCase().includes(q))
        );
    }

    // Sort
    const sortKey = sortBy === "fixed" ? "fixed" : sortBy === "failed" ? "failed" : sortBy === "quality" ? "qualityScore" : "createdAt";
    filtered.sort((a, b) => {
        let aVal = a[sortKey];
        let bVal = b[sortKey];
        if (sortKey === "qualityScore") {
            aVal = aVal?.score || 0;
            bVal = bVal?.score || 0;
        }
        if (sortKey === "createdAt") {
            return sortOrder === "desc" ? (aVal < bVal ? 1 : aVal > bVal ? -1 : 0)
                : (aVal > bVal ? 1 : aVal < bVal ? -1 : 0);
        }
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    // Limit
    if (limit && limit > 0) {
        filtered = filtered.slice(0, limit);
    }

    return filtered;
}

export function getRepairRecord(id) {
    const filePath = path.join(repairsDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Repair record '${id}' not found`);
    }
    return JSON.parse(readFileSync(filePath, "utf8"));
}

export function deleteRepairRecord(id) {
    const filePath = path.join(repairsDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Repair record '${id}' not found`);
    }
    rmSync(filePath, { force: true });
    return filePath;
}

// ─── Clean ────────────────────────────────────────────────────────────

export function cleanHistory() {
    const dir = repairsDir();
    if (!existsSync(dir)) return { deleted: 0 };

    let deleted = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        rmSync(path.join(dir, entry.name), { force: true });
        deleted++;
    }
    return { deleted };
}

// ─── Export ───────────────────────────────────────────────────────────

export function exportRecord(record, format) {
    switch (format) {
        case "json":
            return `${JSON.stringify(record, null, 2)}\n`;
        case "markdown":
        case "md":
            return exportMarkdown(record);
        case "html":
            return exportHTML(record);
        case "csv":
            return exportCSV(record);
        default:
            throw new DevForgeError(`Unknown export format '${format}'. Available: json, markdown, html, csv`);
    }
}

function exportMarkdown(record) {
    const lines = [
        `# Repair Report`,
        ``,
        `**Date:** ${record.createdAt}`,
        `**Machine:** ${record.machine?.hostname || "unknown"}`,
        `**DevForgeKit:** ${record.devforgekitVersion}`,
        `**Duration:** ${((record.durationMs || 0) / 1000).toFixed(1)}s`,
        ``,
        `## Summary`,
        ``,
        `- Issues detected: ${record.issues?.length || 0}`,
        `- Repairs fixed: ${record.fixed || 0}`,
        `- Repairs failed: ${record.failed || 0}`,
        `- Repairs skipped: ${record.skipped || 0}`,
        ``,
        `## Issues`,
        ``,
        `| ID | Severity | Category | Subsystem | Description | Fix |`,
        `|-----|----------|----------|-----------|-------------|-----|`
    ];

    for (const issue of record.issues || []) {
        lines.push(`| ${issue.id} | ${issue.severity} | ${issue.category} | ${issue.subsystem} | ${issue.description} | ${issue.fix} |`);
    }

    if (record.repairResults?.length > 0) {
        lines.push(``, `## Repair Results`, ``);
        lines.push(`| Issue | Status | Error |`, `|-------|--------|-------|`);
        for (const r of record.repairResults) {
            const status = r.ok ? "Fixed" : r.skipped ? "Skipped" : r.manual ? "Manual" : "Failed";
            const error = r.error || "";
            lines.push(`| ${r.issue?.description || ""} | ${status} | ${error} |`);
        }
    }

    if (record.verification) {
        lines.push(``, `## Verification`, ``);
        lines.push(`| Check | Status | Score |`, `|-------|--------|-------|`);
        for (const v of record.verification.results || []) {
            lines.push(`| ${v.check} | ${v.status} | ${v.score || ""} |`);
        }
        lines.push(``, `**Overall: ${record.verification.health?.score}% - ${record.verification.health?.verdict}**`);
    }

    if (record.benchmarkBefore && record.benchmarkAfter) {
        lines.push(``, `## Benchmark Comparison`, ``);
        lines.push(`| Metric | Before | After | Delta |`, `|--------|--------|-------|-------|`);
        lines.push(`| Overall Score | ${record.benchmarkBefore.overallScore} | ${record.benchmarkAfter.overallScore} | ${record.benchmarkAfter.overallScore - record.benchmarkBefore.overallScore} |`);
    }

    return lines.join("\n") + "\n";
}

function exportHTML(record) {
    const issueRows = (record.issues || [])
        .map((i) => `<tr><td>${i.id}</td><td>${i.severity}</td><td>${i.category}</td><td>${i.subsystem}</td><td>${i.description}</td><td>${i.fix}</td></tr>`)
        .join("\n");

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Repair Report - ${record.id}</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; }
</style></head>
<body>
<h1>Repair Report</h1>
<p><strong>Date:</strong> ${record.createdAt}<br>
<strong>Machine:</strong> ${record.machine?.hostname || "unknown"}<br>
<strong>Duration:</strong> ${((record.durationMs || 0) / 1000).toFixed(1)}s</p>
<h2>Summary</h2>
<p>Issues: ${record.issues?.length || 0} | Fixed: ${record.fixed || 0} | Failed: ${record.failed || 0} | Skipped: ${record.skipped || 0}</p>
<h2>Issues</h2>
<table><tr><th>ID</th><th>Severity</th><th>Category</th><th>Subsystem</th><th>Description</th><th>Fix</th></tr>
${issueRows}
</table>
</body></html>
`;
}

function exportCSV(record) {
    const lines = ["id,severity,category,subsystem,description,fix,estimated_time"];
    for (const issue of record.issues || []) {
        const desc = (issue.description || "").replace(/,/g, ";");
        const fix = (issue.fix || "").replace(/,/g, ";");
        lines.push(`${issue.id},${issue.severity},${issue.category},${issue.subsystem},${desc},${fix},${issue.estimatedTime}`);
    }
    return lines.join("\n") + "\n";
}

// ─── Explain (AI) ─────────────────────────────────────────────────────

export async function explainIssues(issues, { provider, model, endpoint } = {}) {
    const { getProvider, resolveApiKey } = await import("./ai/providers/index.js");
    const { getActiveWorkspace } = await import("./workspace/store.js");
    const { buildPrompt } = await import("./ai/prompts/library.js");

    const config = loadConfig();
    const providerId = provider || (config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null);

    if (!providerId) {
        return {
            ok: false,
            error: "No AI provider configured. Run 'devforgekit config set aiProvider <provider>' or pass --provider."
        };
    }

    const workspace = getActiveWorkspace();
    const opts = {
        apiKey: resolveApiKey(providerId, { workspace }),
        model: model || config.aiModel || undefined,
        endpoint: endpoint || config.aiEndpoint || undefined,
        workspace
    };

    const aiProvider = getProvider(providerId, opts);

    const context = {
        issues: issues.map((i) => ({
            severity: i.severity,
            category: i.category,
            subsystem: i.subsystem,
            description: i.description,
            impact: i.impact,
            fix: i.fix
        })),
        machine: { hostname: hostname() },
        totalIssues: issues.length
    };

    const prompt = buildPrompt("explain", context, `Explain these DevForgeKit repair scan results. For each issue, explain the root cause, why it happened, the potential impact, and the recommended solution. Never fabricate information - only use the measured scan results in the context. ${issues.length} issues were detected.`);

    const response = await aiProvider.chat(prompt);
    return { ok: true, explanation: response.content };
}

// ─── Dry Run (Phase 5: Repair Preview) ───────────────────────────────
// dryRunPlan returns a structured preview of what would happen without
// executing any commands. Every action is described with its type,
// command/package, files affected, and risk level.

export function dryRunPlan(plan) {
    const preview = plan.issues.map((issue, i) => {
        const action = issue.action || {};
        let description = "No action";
        let details = {};

        if (action.type === ACTION_TYPES.SHELL) {
            description = `Run: ${action.command}`;
            details = { command: action.command, filesAffected: action.filesAffected || [] };
        } else if (action.type === ACTION_TYPES.INSTALL) {
            description = `Install package: ${action.package}`;
            details = { package: action.package };
        } else if (action.type === ACTION_TYPES.UNINSTALL) {
            description = `Uninstall package: ${action.package}`;
            details = { package: action.package };
        } else if (action.type === ACTION_TYPES.COMPATIBILITY) {
            description = `Compatibility repair for: ${action.subsystem}`;
            details = { subsystem: action.subsystem };
        } else if (action.type === ACTION_TYPES.COMPONENT_REPAIR) {
            description = `Component repair: ${action.package}`;
            details = { package: action.package };
        } else if (action.type === ACTION_TYPES.MANUAL) {
            description = `Manual: ${action.suggestion || issue.fix}`;
            details = { suggestion: action.suggestion || issue.fix };
        }

        return {
            index: i + 1,
            issueId: issue.id,
            title: issue.title,
            severity: issue.severity,
            category: issue.categoryLabel,
            risk: issue.riskLabel,
            actionType: action.type,
            description,
            details,
            estimatedTime: issue.estimatedTime,
            requiresRestart: issue.requiresRestart,
            rollbackAvailable: issue.rollbackAvailable
        };
    });

    return {
        dryRun: true,
        totalRepairs: plan.totalRepairs,
        totalInfo: plan.totalInfo,
        estimatedTime: plan.estimatedTime,
        requiresRestart: plan.requiresRestart,
        riskLevel: plan.riskLabel,
        categoriesAffected: plan.categoriesAffected,
        filesAffected: plan.filesAffected,
        packagesAffected: plan.packagesAffected,
        preview
    };
}

// ─── Repair Quality Score (Phase 12) ─────────────────────────────────
// Scores a repair run on a 0-100 scale based on success rate,
// verification improvement, and safety practices.

export function computeQualityScore(execution, verification) {
    const total = execution.results.length;
    if (total === 0) return { score: 100, grade: "A", verdict: "No repairs needed" };

    const fixed = execution.fixed || 0;
    const failed = execution.failed || 0;
    const skipped = execution.skipped || 0;
    const successRate = (fixed / total) * 100;

    // Safety bonus: rollback snapshot was created
    const safetyBonus = execution.rollbackSnapshot ? 5 : 0;

    // Verification bonus: health score improved
    const healthScore = verification?.health?.score || 0;
    const verificationBonus = healthScore >= 90 ? 5 : healthScore >= 70 ? 3 : 0;

    // Penalty for skipped repairs
    const skipPenalty = skipped * 2;

    const score = Math.max(0, Math.min(100, Math.round(successRate + safetyBonus + verificationBonus - skipPenalty)));

    const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
    const verdict = score >= 90 ? "Excellent" : score >= 80 ? "Good" : score >= 70 ? "Fair" : score >= 60 ? "Poor" : "Critical";

    return { score, grade, verdict, successRate: Math.round(successRate), fixed, failed, skipped, healthScore };
}

// ─── Full Repair Pipeline (Phase 5: Dry-run support) ──────────────────

// silent: true (repair run --json/repair install --json pass this)
// suppresses every logger.*/console.log line this function and its
// dry-run/plan preview print - without it, every one of those lines
// (section headers, per-issue previews, benchmark/quality summaries)
// lands on stdout ahead of the final JSON.stringify(record), corrupting
// it for any script/jq consumer, the same class of bug fixed in
// scanIssues() above.
export async function runFullRepair({ assumeYes = false, skipBenchmark = true, onProgress, dryRun = false, silent = false } = {}) {
    const log = silent ? { section() {}, info() {}, success() {}, warn() {} } : logger;
    const print = silent ? () => {} : (...args) => console.log(...args);
    const startTime = Date.now();
    const createdAt = new Date().toISOString();
    const id = makeRepairId(createdAt);

    // Stage 1: Scan
    const issues = await scanIssues({ onProgress, silent });

    if (issues.length === 0) {
        log.success("No issues detected - environment is healthy!");
        return { id, issues: [], fixed: 0, failed: 0, skipped: 0, durationMs: Date.now() - startTime };
    }

    // Stage 2: Plan
    const plan = planRepairs(issues);

    if (dryRun) {
        log.section("Repair Engine: Dry Run");
        log.info(`Repairs: ${plan.totalRepairs} (plus ${plan.totalInfo} informational)`);
        log.info(`Estimated time: ${plan.estimatedTime}`);
        log.info(`Risk level: ${plan.riskLabel}`);
        if (plan.requiresRestart) log.warn("Some repairs require a restart");
        if (plan.filesAffected.length > 0) {
            log.info(`Files affected: ${plan.filesAffected.join(", ")}`);
        }
        if (plan.packagesAffected.length > 0) {
            log.info(`Packages affected: ${plan.packagesAffected.join(", ")}`);
        }
        log.info("");
        for (let i = 0; i < plan.issues.length; i++) {
            const issue = plan.issues[i];
            print(`  ${i + 1}. [${issue.severity}] ${issue.description}`);
            print(`     Action: ${issue.action?.type} | Risk: ${issue.riskLabel}`);
            print(`     Fix: ${issue.fix}`);
        }
        return dryRunPlan(plan);
    }

    log.section("Repair Plan");
    log.info(`Repairs: ${plan.totalRepairs} (plus ${plan.totalInfo} informational)`);
    log.info(`Estimated time: ${plan.estimatedTime}`);
    log.info(`Risk level: ${plan.riskLabel}`);
    if (plan.requiresRestart) log.warn("Some repairs require a restart");
    for (let i = 0; i < plan.issues.length; i++) {
        const issue = plan.issues[i];
        print(`  ${i + 1}. [${issue.severity}] ${issue.description}`);
        print(`     Fix: ${issue.fix} (Risk: ${issue.riskLabel})`);
    }

    // Stage 3: Create rollback point
    let rollbackSnapshot;
    if (!assumeYes) {
        const shouldContinue = await confirm("\nProceed with repairs? A rollback snapshot will be created first.", false);
        if (!shouldContinue) {
            log.info("Repair cancelled by user");
            return { id, issues, fixed: 0, failed: 0, skipped: 0, cancelled: true, durationMs: Date.now() - startTime };
        }
    }

    rollbackSnapshot = await createRollbackPoint();

    // Stage 3.5: Pre-repair benchmark (optional)
    let benchmarkBefore = null;
    if (!skipBenchmark) {
        try {
            const { runBenchmark } = await import("./benchmark.js");
            log.info("Running pre-repair benchmark...");
            benchmarkBefore = await runBenchmark({ profile: "quick", silent });
        } catch {
            // Non-critical
        }
    }

    // Stage 4: Execute
    const execution = await executeRepairs(plan, { assumeYes, onProgress, rollbackSnapshot: rollbackSnapshot?.id, silent });

    // Stage 5: Verify
    const verification = await verifyRepairs({ runBenchmark: !skipBenchmark, silent });

    // Post-repair benchmark
    let benchmarkAfter = null;
    if (!skipBenchmark) {
        try {
            const { runBenchmark } = await import("./benchmark.js");
            log.info("Running post-repair benchmark...");
            benchmarkAfter = await runBenchmark({ profile: "quick", silent });
            if (benchmarkBefore && benchmarkAfter) {
                const delta = benchmarkAfter.overallScore - benchmarkBefore.overallScore;
                const sign = delta > 0 ? "+" : "";
                log.section("Benchmark Comparison");
                log.info(`Before: ${benchmarkBefore.overallScore}  After: ${benchmarkAfter.overallScore}  (${sign}${delta})`);
            }
        } catch {
            // Non-critical
        }
    }

    // Phase 12: Compute repair quality score
    const qualityScore = computeQualityScore(execution, verification);
    log.section("Repair Quality Score");
    log.info(`Score: ${qualityScore.score}/100 (${qualityScore.grade}) - ${qualityScore.verdict}`);

    const durationMs = Date.now() - startTime;
    const platform = getPlatform();
    const machine = { hostname: hostname(), platform: platform.id, user: userInfo().username || "unknown" };

    const record = {
        repairVersion: REPAIR_VERSION,
        id,
        createdAt,
        durationMs,
        devforgekitVersion: getVersion(),
        machine,
        issues,
        plan: {
            totalRepairs: plan.totalRepairs,
            estimatedTime: plan.estimatedTime,
            requiresRestart: plan.requiresRestart,
            riskLevel: plan.riskLevel,
            riskLabel: plan.riskLabel,
            categoriesAffected: plan.categoriesAffected,
            filesAffected: plan.filesAffected,
            packagesAffected: plan.packagesAffected
        },
        repairResults: execution.results,
        fixed: execution.fixed,
        failed: execution.failed,
        skipped: execution.skipped,
        filesModified: execution.filesModified || 0,
        rollbackAvailable: execution.rollbackAvailable || false,
        rollbackSnapshotId: rollbackSnapshot?.id || null,
        verification,
        qualityScore,
        benchmarkBefore: benchmarkBefore ? { overallScore: benchmarkBefore.overallScore, overallGrade: benchmarkBefore.overallGrade } : null,
        benchmarkAfter: benchmarkAfter ? { overallScore: benchmarkAfter.overallScore, overallGrade: benchmarkAfter.overallGrade } : null
    };

    // Save to history
    saveRepairRecord(record);

    log.section("Repair Complete");
    log.success(`ID: ${id}`);
    log.info(`Fixed: ${execution.fixed}, Failed: ${execution.failed}, Skipped: ${execution.skipped}`);
    log.info(`Quality: ${qualityScore.score}/100 (${qualityScore.grade})`);
    if (rollbackSnapshot) {
        log.info(`Rollback snapshot: ${rollbackSnapshot.id}`);
    }

    return record;
}

// ─── Performance Audit (Phase 14) ─────────────────────────────────────
// Benchmarks each stage of the repair pipeline to identify bottlenecks.
// Returns structured timing data for analysis.

export async function benchmarkRepairEngine({ iterations = 3, silent = false } = {}) {
    const log = silent ? { section() {}, info() {} } : logger;
    const print = silent ? () => {} : (...args) => console.log(...args);
    const results = {
        scan: [],
        plan: [],
        historyLoad: [],
        registryLoad: [],
        totalPerRun: []
    };

    log.section("Repair Engine Performance Audit");
    log.info(`Running ${iterations} iteration(s)...\n`);

    for (let iter = 0; iter < iterations; iter++) {
        const runStart = Date.now();

        // Benchmark: Registry load
        const regStart = Date.now();
        loadPackages();
        results.registryLoad.push(Date.now() - regStart);

        // Benchmark: Scan
        const scanStart = Date.now();
        const issues = await scanIssues({ silent: true });
        const scanMs = Date.now() - scanStart;
        results.scan.push(scanMs);

        // Benchmark: Plan
        const planStart = Date.now();
        const plan = planRepairs(issues);
        const planMs = Date.now() - planStart;
        results.plan.push(planMs);

        // Benchmark: History load
        const histStart = Date.now();
        listHistory();
        results.historyLoad.push(Date.now() - histStart);

        results.totalPerRun.push(Date.now() - runStart);

        log.info(`  Iteration ${iter + 1}: scan=${scanMs}ms, plan=${planMs}ms, total=${Date.now() - runStart}ms, issues=${issues.length}`);
    }

    // Compute averages
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const min = (arr) => Math.min(...arr);
    const max = (arr) => Math.max(...arr);

    const summary = {
        scan: { avg: avg(results.scan), min: min(results.scan), max: max(results.scan) },
        plan: { avg: avg(results.plan), min: min(results.plan), max: max(results.plan) },
        historyLoad: { avg: avg(results.historyLoad), min: min(results.historyLoad), max: max(results.historyLoad) },
        registryLoad: { avg: avg(results.registryLoad), min: min(results.registryLoad), max: max(results.registryLoad) },
        totalPerRun: { avg: avg(results.totalPerRun), min: min(results.totalPerRun), max: max(results.totalPerRun) },
        iterations,
        rawResults: results
    };

    log.section("Performance Summary");
    print(`  Stage           Avg      Min      Max`);
    print(`  ${"-".repeat(45)}`);
    print(`  Registry load   ${summary.registryLoad.avg.toString().padStart(6)}ms  ${summary.registryLoad.min.toString().padStart(6)}ms  ${summary.registryLoad.max.toString().padStart(6)}ms`);
    print(`  Scan            ${summary.scan.avg.toString().padStart(6)}ms  ${summary.scan.min.toString().padStart(6)}ms  ${summary.scan.max.toString().padStart(6)}ms`);
    print(`  Plan            ${summary.plan.avg.toString().padStart(6)}ms  ${summary.plan.min.toString().padStart(6)}ms  ${summary.plan.max.toString().padStart(6)}ms`);
    print(`  History load    ${summary.historyLoad.avg.toString().padStart(6)}ms  ${summary.historyLoad.min.toString().padStart(6)}ms  ${summary.historyLoad.max.toString().padStart(6)}ms`);
    print(`  ${"-".repeat(45)}`);
    print(`  Total per run   ${summary.totalPerRun.avg.toString().padStart(6)}ms  ${summary.totalPerRun.min.toString().padStart(6)}ms  ${summary.totalPerRun.max.toString().padStart(6)}ms`);

    // Identify bottleneck
    const stages = [
        { name: "Registry load", ms: summary.registryLoad.avg },
        { name: "Scan", ms: summary.scan.avg },
        { name: "Plan", ms: summary.plan.avg },
        { name: "History load", ms: summary.historyLoad.avg }
    ];
    stages.sort((a, b) => b.ms - a.ms);
    log.info(`\n  Bottleneck: ${stages[0].name} (${stages[0].ms}ms avg)`);

    // Recommendations
    log.info("\n  Recommendations:");
    if (summary.scan.avg > 5000) {
        log.info("    • Scan is slow (>5s) — consider parallelizing scanners with Promise.allSettled");
    }
    if (summary.historyLoad.avg > 100) {
        log.info("    • History loading is slow — consider adding an index file for large histories");
    }
    if (summary.registryLoad.avg > 50) {
        log.info("    • Registry loading is slow — consider caching package list in memory");
    }
    if (summary.plan.avg > 100) {
        log.info("    • Plan generation is slow — review dependency graph traversal");
    }
    if (summary.totalPerRun.avg < 2000) {
        log.info("    • Overall performance is good (<2s per run)");
    }

    return summary;
}
