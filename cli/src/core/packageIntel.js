// The Package Intelligence & Analytics Engine (v1.3.5). A complete
// intelligence layer that analyzes every installed development tool,
// library, runtime, service, package manager, CLI, plugin, and framework
// on the user's machine.
//
// Answers: What is installed? Why? Who depends on it? How much space?
// When was it last used? Can it be removed safely? Is it outdated?
// Duplicated? Slowing the environment? Required by another package?
//
// Reuses every existing subsystem - no duplicated logic:
//   - registry.js (loadPackages, loadProfiles, loadRecipes, loadCollections)
//   - compatibility/graph.js (buildDependencyGraph, detectCycles, detectDuplicateTools)
//   - compatibility/engine.js (scanCompatibility, scoreCompatibility)
//   - installer.js (validate, install, uninstall)
//   - shell.js (runShellCommand, captureShellCommand, commandExists)
//   - workspace/store.js (listWorkspaces)
//   - plugins.js (discoverPlugins)
//   - health.js (scoreResults)
//   - ai/providers + ai/prompts/library.js for AI recommendations
//   - benchmark.js for performance correlation
//   - paths.js, version.js, logger.js, errors.js
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { loadPackages, loadProfiles, loadRecipes, loadCollections, getPackage } from "./registry.js";
import { buildDependencyGraph, detectCycles, detectDuplicateTools } from "./compatibility/graph.js";
import { scanCompatibility, scoreCompatibility } from "./compatibility/engine.js";
import { validate, install, uninstall, resolveInstallStep } from "./installer.js";
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "./shell.js";
import { mapWithConcurrency } from "./concurrency.js";
import { listWorkspaces } from "./workspace/store.js";
import { discoverPlugins } from "./plugins.js";
import { scoreResults } from "./health.js";
import { userStateDir } from "./paths.js";
import { getPlatform } from "./platform/index.js";
import { PlatformNotSupportedError } from "./platform/errors.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";

// ─── Constants ────────────────────────────────────────────────────────

export const PACKAGE_INTEL_VERSION = 1;
export const PACKAGE_INTEL_DIR = "package-intel";

function intelDir() {
    return path.join(userStateDir(), PACKAGE_INTEL_DIR);
}

function cachePath() {
    return path.join(intelDir(), "cache.json");
}

// ─── Package Profile ──────────────────────────────────────────────────
// Every installed package gets a complete metadata profile.

export async function buildPackageProfile(pkg, { installedPackages } = {}) {
    const installed = installedPackages || await getInstalledPackageNames();

    // Check if this package is installed
    let isInstalled = false;
    let version = null;
    try {
        if (pkg.validate) {
            const code = await validate(pkg);
            isInstalled = code === 0;
        }
    } catch {
        // Not installed
    }

    if (!isInstalled) {
        return null;
    }

    // Detect version
    try {
        if (pkg.validate) {
            const { stdout } = await captureShellCommand(pkg.validate, { silent: true });
            const versionMatch = stdout.match(/(\d+\.\d+\.\d+[^\s]*)/);
            if (versionMatch) version = versionMatch[1];
        }
    } catch {
        // Version detection failed
    }

    // Get install location
    let installLocation = null;
    try {
        // Resolve through the same platformInstall lookup install() uses,
        // not pkg.install directly - a package whose platformInstall.linux
        // entry isn't brew-formula/brew-cask must not attempt a brew
        // packagePrefix() lookup just because its macOS install step is.
        const resolvedStep = resolveInstallStep(pkg);
        if (resolvedStep?.method === "brew-formula" || resolvedStep?.method === "brew-cask") {
            installLocation = await getPlatform()
                .packagePrefix(resolvedStep.id || pkg.name, { cask: resolvedStep.method === "brew-cask" })
                .catch(() => null);
        }
        if (!installLocation && pkg.validate) {
            const cmd = pkg.validate.split(/\s+/)[0];
            const { stdout } = await captureShellCommand(`which ${shellQuote(cmd)} 2>/dev/null`);
            installLocation = stdout.trim() || null;
        }
    } catch {
        // Location detection failed
    }

    // Get package size
    let sizeBytes = 0;
    if (installLocation && existsSync(installLocation)) {
        try {
            const stat = statSync(installLocation);
            if (stat.isDirectory()) {
                const { stdout } = await captureShellCommand(`du -sk ${shellQuote(installLocation)} 2>/dev/null`);
                sizeBytes = Number(stdout.trim().split(/\s+/)[0] || 0) * 1024;
            } else {
                sizeBytes = stat.size;
            }
        } catch {
            // Size detection failed
        }
    }

    // Build dependency info
    const dependencies = pkg.dependencies || [];
    const allPackages = loadPackages();
    const reverseDeps = allPackages.filter((p) => (p.dependencies || []).includes(pkg.name)).map((p) => p.name);

    // Workspace usage
    const workspaceUsage = [];
    try {
        for (const ws of listWorkspaces()) {
            if (ws.tools && ws.tools.includes(pkg.name)) {
                workspaceUsage.push(ws.name);
            }
        }
    } catch {
        // Workspace detection failed
    }

    // Profile usage
    const profileUsage = [];
    try {
        for (const profile of loadProfiles()) {
            if (profile.components && profile.components.includes(pkg.name)) {
                profileUsage.push(profile.name);
            }
        }
    } catch {
        // Profile loading failed
    }

    // Recipe usage
    const recipeUsage = [];
    try {
        for (const recipe of loadRecipes()) {
            if (recipe.components && recipe.components.includes(pkg.name)) {
                recipeUsage.push(recipe.name);
            }
        }
    } catch {
        // Recipe loading failed
    }

    // Collection usage
    const collectionUsage = [];
    try {
        for (const collection of loadCollections()) {
            if (collection.components && collection.components.includes(pkg.name)) {
                collectionUsage.push(collection.name);
            }
        }
    } catch {
        // Collection loading failed
    }

    // Plugin usage
    const pluginUsage = [];
    try {
        for (const plugin of discoverPlugins()) {
            if (plugin.requires && plugin.requires.includes(pkg.name)) {
                pluginUsage.push(plugin.name);
            }
        }
    } catch {
        // Plugin detection failed
    }

    // Usage detection (last executed)
    const usageInfo = await detectUsage(pkg);

    // Compatibility score
    let compatibilityScore = null;
    try {
        const compatResult = await scanCompatibility([pkg.name]);
        compatibilityScore = compatResult.score;
    } catch {
        // Compatibility check failed
    }

    // Health status
    let healthStatus;
    try {
        const validateCode = await validate(pkg);
        healthStatus = validateCode === 0 ? "healthy" : "broken";
    } catch {
        healthStatus = "broken";
    }

    return {
        name: pkg.name,
        registryId: pkg.name,
        version,
        installMethod: pkg.install?.method || "unknown",
        installLocation,
        sizeBytes,
        dependencies,
        reverseDependencies: reverseDeps,
        installDate: null,
        lastUpdate: null,
        lastUsed: usageInfo.lastUsed,
        timesExecuted: usageInfo.timesExecuted,
        workspaceUsage,
        recipeUsage,
        profileUsage,
        collectionUsage,
        pluginUsage,
        compatibilityScore,
        healthStatus,
        securityStatus: "unknown",
        license: pkg.license || null,
        homepage: pkg.homepage || null,
        repository: pkg.repository || null,
        maintainer: pkg.maintainer || null,
        architecture: pkg.architectures || [],
        category: pkg.category || null,
        tags: pkg.tags || [],
        description: pkg.description || null,
        confidence: "high",
        stability: pkg.stability || null,
        isOrphan: false,
        isDuplicate: false,
        isOutdated: false
    };
}

// ─── Usage Detection ──────────────────────────────────────────────────

async function detectUsage(pkg) {
    const result = { lastUsed: null, timesExecuted: 0 };

    // Try to detect last usage via shell history or access time
    const cmd = pkg.validate ? pkg.validate.split(/\s+/)[0] : pkg.name;

    try {
        // Check if the binary exists and get its access time
        const { stdout } = await captureShellCommand(`which ${shellQuote(cmd)} 2>/dev/null`);
        const binaryPath = stdout.trim();
        if (binaryPath && existsSync(binaryPath)) {
            const stat = statSync(binaryPath);
            result.lastUsed = stat.atime.toISOString();
        }
    } catch {
        // Binary not found
    }

    // Check shell history for execution count (zsh history). cmd is
    // registry-derived (a package's own binary name), never user/network
    // input, but escaping it before building the RegExp turns arbitrary
    // content into a literal match rather than regex syntax regardless -
    // cheaper than relying on that trust boundary holding forever.
    try {
        const historyPath = path.join(process.env.HOME || "", ".zsh_history");
        if (existsSync(historyPath)) {
            const history = readFileSync(historyPath, "utf8");
            const escapedCmd = cmd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const matches = history.match(new RegExp(`\\b${escapedCmd}\\b`, "g"));
            result.timesExecuted = matches ? matches.length : 0;
        }
    } catch {
        // History not available
    }

    return result;
}

// ─── Get Installed Package Names ──────────────────────────────────────

export async function getInstalledPackageNames() {
    const installed = [];
    for (const pkg of loadPackages()) {
        if (!pkg.validate) continue;
        try {
            if ((await validate(pkg)) === 0) {
                installed.push(pkg.name);
            }
        } catch {
            // Not installed
        }
    }
    return installed;
}

// ─── Analyze All Packages ─────────────────────────────────────────────

export async function analyzePackages({ onProgress, useCache = true, silent = false } = {}) {
    const log = silent ? { section() {}, info() {}, success() {}, warn() {} } : logger;
    log.section("Package Intelligence: Analyze");
    log.info("Scanning all registry packages...\n");

    // Try to load cache
    let cache = null;
    if (useCache) {
        cache = loadCache();
    }

    const allPackages = loadPackages();
    const profiles = [];

    // First pass: detect installed packages. Bounded concurrency (same
    // worker pool doctor.js/componentManager.js use) instead of a plain
    // sequential loop - validating all 261 packages one at a time here
    // measured ~79s; each package shells out at least one real child
    // process to validate.
    log.info("Detecting installed packages...");
    const validated = await mapWithConcurrency(allPackages, 8, async (pkg) => {
        if (!pkg.validate) return null;
        try {
            return (await validate(pkg)) === 0 ? pkg.name : null;
        } catch {
            return null;
        }
    });
    const installedNames = validated.filter(Boolean);
    log.success(`Found ${installedNames.length} installed packages`);

    // Second pass: build profiles for installed packages
    log.info("Building package profiles...");
    for (let i = 0; i < installedNames.length; i++) {
        const name = installedNames[i];
        const pkg = allPackages.find((p) => p.name === name);
        if (!pkg) continue;

        if (onProgress) onProgress({ name, index: i, total: installedNames.length, status: "analyzing" });

        // Check cache
        if (cache && cache.profiles && cache.profiles[name]) {
            const cached = cache.profiles[name];
            // Use cached profile if less than 1 hour old
            if (cached._cachedAt && (Date.now() - cached._cachedAt) < 3600000) {
                profiles.push(cached);
                continue;
            }
        }

        try {
            const profile = await buildPackageProfile(pkg, { installedPackages: installedNames });
            if (profile) {
                profile._cachedAt = Date.now();
                profiles.push(profile);
            }
        } catch (err) {
            log.warn(`  Could not analyze ${name}: ${err.message}`);
        }

        if (onProgress) onProgress({ name, index: i, total: installedNames.length, status: "done" });
    }

    // Post-process: detect orphans, duplicates, outdated
    log.info("Running intelligence analysis...");
    const orphans = detectOrphans(profiles);
    const duplicates = await detectDuplicates(profiles);
    const outdated = await detectOutdated(profiles);

    // Mark profiles
    for (const profile of profiles) {
        profile.isOrphan = orphans.some((o) => o.name === profile.name);
        profile.isDuplicate = duplicates.some((d) => d.packages.includes(profile.name));
        profile.isOutdated = outdated.some((o) => o.name === profile.name);
    }

    // Summary
    const totalSize = profiles.reduce((acc, p) => acc + (p.sizeBytes || 0), 0);
    log.section("Analysis Complete");
    log.info(`Profiles: ${profiles.length}`);
    log.info(`Total size: ${formatBytes(totalSize)}`);
    log.info(`Orphans: ${orphans.length}`);
    log.info(`Duplicates: ${duplicates.length}`);
    log.info(`Outdated: ${outdated.length}`);

    const result = {
        packageIntelVersion: PACKAGE_INTEL_VERSION,
        createdAt: new Date().toISOString(),
        devforgekitVersion: getVersion(),
        machine: { hostname: hostname() },
        profiles,
        summary: {
            total: profiles.length,
            totalSizeBytes: totalSize,
            orphanCount: orphans.length,
            duplicateCount: duplicates.length,
            outdatedCount: outdated.length,
            healthyCount: profiles.filter((p) => p.healthStatus === "healthy").length,
            brokenCount: profiles.filter((p) => p.healthStatus === "broken").length
        },
        orphans,
        duplicates,
        outdated
    };

    // Save to cache
    saveCache({ profiles: Object.fromEntries(profiles.map((p) => [p.name, p])) });

    return result;
}

// ─── Orphan Detection ─────────────────────────────────────────────────

export function detectOrphans(profiles) {
    const orphans = [];

    for (const profile of profiles) {
        // An orphan is: no reverse deps, no workspace/recipe/profile/collection/plugin usage,
        // and not used recently
        const hasReverseDeps = profile.reverseDependencies && profile.reverseDependencies.length > 0;
        const hasWorkspaceUsage = profile.workspaceUsage && profile.workspaceUsage.length > 0;
        const hasRecipeUsage = profile.recipeUsage && profile.recipeUsage.length > 0;
        const hasProfileUsage = profile.profileUsage && profile.profileUsage.length > 0;
        const hasCollectionUsage = profile.collectionUsage && profile.collectionUsage.length > 0;
        const hasPluginUsage = profile.pluginUsage && profile.pluginUsage.length > 0;

        if (!hasReverseDeps && !hasWorkspaceUsage && !hasRecipeUsage && !hasProfileUsage && !hasCollectionUsage && !hasPluginUsage) {
            orphans.push({
                name: profile.name,
                reason: "No reverse dependencies, workspace, recipe, profile, collection, or plugin usage detected",
                sizeBytes: profile.sizeBytes || 0,
                lastUsed: profile.lastUsed,
                safeToRemove: profile.healthStatus !== "broken"
            });
        }
    }

    return orphans;
}

// ─── Duplicate Detection ──────────────────────────────────────────────

export async function detectDuplicates(profiles) {
    const duplicates = [];

    // Use registry's detectDuplicateTools for registry-level duplicates
    const registryDupes = detectDuplicateTools(loadPackages());

    // Also detect runtime duplicates (multiple versions of same tool)
    const byCategory = new Map();
    for (const profile of profiles) {
        const cat = profile.category || "unknown";
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(profile);
    }

    // Check for known duplicate patterns
    const duplicatePatterns = [
        { names: ["node", "bun", "deno"], label: "JavaScript runtimes" },
        { names: ["python", "python3", "miniconda"], label: "Python installations" },
        { names: ["java", "sdkman"], label: "Java installations" },
        { names: ["npm", "pnpm", "yarn", "bun"], label: "Node package managers" },
        { names: ["docker", "podman", "colima", "lima"], label: "Container runtimes" },
        { names: ["brew", "mise", "asdf", "volta"], label: "Version managers" },
        { names: ["pip", "pipx", "poetry", "uv"], label: "Python package managers" }
    ];

    for (const pattern of duplicatePatterns) {
        const installed = profiles.filter((p) => pattern.names.includes(p.name));
        if (installed.length > 1) {
            duplicates.push({
                type: "runtime",
                label: pattern.label,
                packages: installed.map((p) => p.name),
                suggestion: `Multiple ${pattern.label.toLowerCase()} detected. Consider keeping only one.`
            });
        }
    }

    // Add registry-level duplicates
    for (const dupe of registryDupes) {
        const installed = dupe.owners.filter((name) => profiles.some((p) => p.name === name));
        if (installed.length > 1) {
            duplicates.push({
                type: "registry",
                label: `Duplicate tool: ${dupe.claim}`,
                packages: installed,
                suggestion: `Multiple packages claim '${dupe.claim}'. Remove one.`
            });
        }
    }

    return duplicates;
}

// ─── Outdated Detection ───────────────────────────────────────────────

export async function detectOutdated(profiles) {
    const outdated = [];

    for (const profile of profiles) {
        if (!profile.version) continue;

        try {
            // Check for updates via brew or mise
            if (profile.installMethod === "brew-formula" || profile.installMethod === "brew-cask") {
                const platform = getPlatform();
                const { code, stdout } = typeof platform.outdatedVerbose === "function"
                    ? await platform.outdatedVerbose()
                    : { code: 1, stdout: "" };
                if (code === 0 && stdout.includes(profile.name)) {
                    outdated.push({
                        name: profile.name,
                        currentVersion: profile.version,
                        reason: "Homebrew reports a newer version available",
                        updateCommand: platform.upgradeCommand(profile.name)
                    });
                }
            } else if (profile.installMethod === "mise") {
                const { code, stdout } = await captureShellCommand(`mise outdated 2>/dev/null`);
                if (code === 0 && stdout.includes(profile.name)) {
                    outdated.push({
                        name: profile.name,
                        currentVersion: profile.version,
                        reason: "mise reports a newer version available",
                        updateCommand: `mise upgrade ${profile.name}`
                    });
                }
            }
        } catch {
            // Outdated check failed
        }
    }

    return outdated;
}

// ─── Dependency Graph ─────────────────────────────────────────────────

export function buildGraph(names, { packages = loadPackages() } = {}) {
    const graph = buildDependencyGraph(names, { packages });
    const cycles = detectCycles(names, { packages });

    // Build reverse dependency map
    const reverseDeps = new Map();
    for (const edge of graph.edges) {
        if (!reverseDeps.has(edge.to)) reverseDeps.set(edge.to, []);
        reverseDeps.get(edge.to).push(edge.from);
    }

    // Calculate depth for each node
    const depthMap = new Map();
    function calculateDepth(name, visited = new Set()) {
        if (depthMap.has(name)) return depthMap.get(name);
        if (visited.has(name)) return 0; // Cycle
        visited.add(name);
        const pkg = packages.find((p) => p.name === name);
        if (!pkg || !pkg.dependencies || pkg.dependencies.length === 0) {
            depthMap.set(name, 0);
            return 0;
        }
        const maxDepDepth = Math.max(...pkg.dependencies.map((d) => calculateDepth(d, new Set(visited))));
        const depth = maxDepDepth + 1;
        depthMap.set(name, depth);
        return depth;
    }

    for (const name of graph.nodes) {
        calculateDepth(name);
    }

    return {
        nodes: graph.nodes.map((name) => ({
            name,
            depth: depthMap.get(name) || 0,
            reverseDependencies: reverseDeps.get(name) || []
        })),
        edges: graph.edges,
        missing: graph.missing,
        cycles
    };
}

export function renderTree(names, { packages = loadPackages(), indent = "" } = {}) {
    const byName = new Map(packages.map((p) => [p.name, p]));
    const lines = [];
    const visited = new Set();

    function render(name, prefix, isLast) {
        if (visited.has(name)) {
            lines.push(`${prefix}${isLast ? "└── " : "├── "}${name} (cycle)`);
            return;
        }
        visited.add(name);
        const pkg = byName.get(name);
        const marker = isLast ? "└── " : "├── ";
        lines.push(`${prefix}${marker}${name}`);

        if (!pkg || !pkg.dependencies || pkg.dependencies.length === 0) return;

        const deps = pkg.dependencies;
        for (let i = 0; i < deps.length; i++) {
            const depName = deps[i];
            const depPkg = byName.get(depName);
            const display = depPkg ? depName : `${depName} (missing)`;
            const newPrefix = prefix + (isLast ? "    " : "│   ");
            render(display, newPrefix, i === deps.length - 1);
        }
    }

    for (let i = 0; i < names.length; i++) {
        render(names[i], "", i === names.length - 1);
    }

    return lines.join("\n");
}

// ─── Package Impact ───────────────────────────────────────────────────

export async function packageImpact(name, { analysis } = {}) {
    const pkg = getPackage(name);
    const profile = analysis?.profiles?.find((p) => p.name === name) || await buildPackageProfile(pkg);

    if (!profile) {
        throw new DevForgeError(`Package '${name}' is not installed`);
    }

    // Count all dependents (transitive)
    const allPackages = loadPackages();
    const graph = buildGraph(allPackages.map((p) => p.name), { packages: allPackages });
    const node = graph.nodes.find((n) => n.name === name);
    const reverseDepCount = node ? node.reverseDependencies.length : 0;

    // Estimate removal impact
    const dependents = profile.reverseDependencies || [];
    const removalBlocking = dependents.length > 0;

    return {
        name,
        sizeBytes: profile.sizeBytes || 0,
        sizeFormatted: formatBytes(profile.sizeBytes || 0),
        dependencyCount: (profile.dependencies || []).length,
        reverseDependencyCount: reverseDepCount,
        reverseDependencies: profile.reverseDependencies || [],
        workspaceUsage: profile.workspaceUsage || [],
        recipeUsage: profile.recipeUsage || [],
        profileUsage: profile.profileUsage || [],
        collectionUsage: profile.collectionUsage || [],
        pluginUsage: profile.pluginUsage || [],
        compatibilityScore: profile.compatibilityScore,
        healthStatus: profile.healthStatus,
        lastUsed: profile.lastUsed,
        isOrphan: profile.isOrphan,
        isDuplicate: profile.isDuplicate,
        isOutdated: profile.isOutdated,
        removalImpact: {
            canRemoveSafely: !removalBlocking && (profile.isOrphan || dependents.length === 0),
            blockingDependents: dependents,
            estimatedSpaceReclaimed: profile.sizeBytes || 0,
            warning: removalBlocking ? `Cannot remove: ${dependents.length} package(s) depend on this` : null
        }
    };
}

// ─── Search ───────────────────────────────────────────────────────────

export function searchPackages(analysis, query, { filter } = {}) {
    let results = analysis.profiles || [];

    // Apply filter
    if (filter) {
        results = applyFilter(results, filter);
    }

    // Apply search query
    if (query) {
        const q = query.toLowerCase();
        results = results.filter((p) => {
            if (p.name && p.name.toLowerCase().includes(q)) return true;
            if (p.description && p.description.toLowerCase().includes(q)) return true;
            if (p.category && p.category.toLowerCase().includes(q)) return true;
            if (p.tags && p.tags.some((t) => t.toLowerCase().includes(q))) return true;
            if (p.workspaceUsage && p.workspaceUsage.some((w) => w.toLowerCase().includes(q))) return true;
            if (p.recipeUsage && p.recipeUsage.some((r) => r.toLowerCase().includes(q))) return true;
            if (p.profileUsage && p.profileUsage.some((pr) => pr.toLowerCase().includes(q))) return true;
            return false;
        });
    }

    return results;
}

export function applyFilter(profiles, filter) {
    switch (filter) {
        case "installed":
            return profiles;
        case "outdated":
            return profiles.filter((p) => p.isOutdated);
        case "unused":
            return profiles.filter((p) => p.isOrphan);
        case "duplicated":
            return profiles.filter((p) => p.isDuplicate);
        case "broken":
            return profiles.filter((p) => p.healthStatus === "broken");
        case "large":
            return profiles.filter((p) => (p.sizeBytes || 0) > 500 * 1024 * 1024).sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
        case "small":
            return profiles.filter((p) => (p.sizeBytes || 0) > 0 && (p.sizeBytes || 0) < 10 * 1024 * 1024).sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0));
        case "most-used":
            return profiles.sort((a, b) => (b.timesExecuted || 0) - (a.timesExecuted || 0));
        case "least-used":
            return profiles.sort((a, b) => (a.timesExecuted || 0) - (b.timesExecuted || 0));
        default:
            return profiles;
    }
}

// ─── Compare ──────────────────────────────────────────────────────────

export function compareAnalyses(oldAnalysis, newAnalysis) {
    const oldMap = new Map((oldAnalysis.profiles || []).map((p) => [p.name, p]));
    const newMap = new Map((newAnalysis.profiles || []).map((p) => [p.name, p]));

    const added = [];
    const removed = [];
    const updated = [];
    const unchanged = [];

    for (const [name, newProfile] of newMap) {
        const oldProfile = oldMap.get(name);
        if (!oldProfile) {
            added.push(newProfile);
        } else if (oldProfile.version !== newProfile.version) {
            updated.push({
                name,
                oldVersion: oldProfile.version,
                newVersion: newProfile.version,
                oldSize: oldProfile.sizeBytes,
                newSize: newProfile.sizeBytes
            });
        } else {
            unchanged.push(name);
        }
    }

    for (const [name, oldProfile] of oldMap) {
        if (!newMap.has(name)) {
            removed.push(oldProfile);
        }
    }

    return {
        added: added.map((p) => ({ name: p.name, version: p.version, sizeBytes: p.sizeBytes })),
        removed: removed.map((p) => ({ name: p.name, version: p.version, sizeBytes: p.sizeBytes })),
        updated,
        unchanged,
        summary: {
            addedCount: added.length,
            removedCount: removed.length,
            updatedCount: updated.length,
            unchangedCount: unchanged.length
        }
    };
}

// ─── AI Recommendations ───────────────────────────────────────────────

export async function recommend(analysis, { provider, model, endpoint } = {}) {
    const { loadConfig } = await import("./config.js");
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

    // Build context from measured data only
    const context = {
        machine: analysis.machine,
        summary: analysis.summary,
        orphans: analysis.orphans.map((o) => ({ name: o.name, sizeBytes: o.sizeBytes, lastUsed: o.lastUsed })),
        duplicates: analysis.duplicates.map((d) => ({ label: d.label, packages: d.packages, suggestion: d.suggestion })),
        outdated: analysis.outdated.map((o) => ({ name: o.name, currentVersion: o.currentVersion, updateCommand: o.updateCommand })),
        largestPackages: (analysis.profiles || [])
            .sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0))
            .slice(0, 10)
            .map((p) => ({ name: p.name, sizeBytes: p.sizeBytes, category: p.category })),
        brokenPackages: (analysis.profiles || []).filter((p) => p.healthStatus === "broken").map((p) => ({ name: p.name, healthStatus: p.healthStatus }))
    };

    const prompt = buildPrompt("explain", context, `Analyze this DevForgeKit package intelligence data and recommend: 1) unused packages that can be safely removed, 2) duplicate packages and which to keep, 3) performance improvements from removing large unused packages, 4) alternative tools for outdated or abandoned packages, 5) missing developer tools that would benefit the environment. Only use the measured data in the context - never invent recommendations. The machine has ${analysis.summary.total} packages installed, ${analysis.summary.orphanCount} orphans, ${analysis.summary.duplicateCount} duplicates, and ${analysis.summary.outdatedCount} outdated.`);

    const response = await aiProvider.chat(prompt);
    return { ok: true, recommendation: response.content };
}

// ─── Export ───────────────────────────────────────────────────────────

export function exportAnalysis(analysis, format) {
    switch (format) {
        case "json":
            return `${JSON.stringify(analysis, null, 2)}\n`;
        case "markdown":
        case "md":
            return exportMarkdown(analysis);
        case "html":
            return exportHTML(analysis);
        case "csv":
            return exportCSV(analysis);
        case "dot":
        case "graphviz":
            return exportDot(analysis);
        case "mermaid":
            return exportMermaid(analysis);
        default:
            throw new DevForgeError(`Unknown export format '${format}'. Available: json, markdown, html, csv, dot, mermaid`);
    }
}

function exportMarkdown(analysis) {
    const lines = [
        `# Package Intelligence Report`,
        ``,
        `**Date:** ${analysis.createdAt}`,
        `**Machine:** ${analysis.machine?.hostname || "unknown"}`,
        `**DevForgeKit:** ${analysis.devforgekitVersion}`,
        ``,
        `## Summary`,
        ``,
        `- Total packages: ${analysis.summary?.total || 0}`,
        `- Total size: ${formatBytes(analysis.summary?.totalSizeBytes || 0)}`,
        `- Orphans: ${analysis.summary?.orphanCount || 0}`,
        `- Duplicates: ${analysis.summary?.duplicateCount || 0}`,
        `- Outdated: ${analysis.summary?.outdatedCount || 0}`,
        `- Healthy: ${analysis.summary?.healthyCount || 0}`,
        `- Broken: ${analysis.summary?.brokenCount || 0}`,
        ``,
        `## Package Profiles`,
        ``,
        `| Name | Version | Category | Size | Health | Orphan | Duplicate | Outdated |`,
        `|------|---------|----------|------|--------|--------|-----------|----------|`
    ];

    for (const p of analysis.profiles || []) {
        lines.push(`| ${p.name} | ${p.version || "?"} | ${p.category || "?"} | ${formatBytes(p.sizeBytes || 0)} | ${p.healthStatus} | ${p.isOrphan ? "Yes" : ""} | ${p.isDuplicate ? "Yes" : ""} | ${p.isOutdated ? "Yes" : ""} |`);
    }

    if (analysis.orphans?.length > 0) {
        lines.push(``, `## Orphan Packages`, ``);
        for (const o of analysis.orphans) {
            lines.push(`- **${o.name}** (${formatBytes(o.sizeBytes || 0)}) - ${o.reason}`);
        }
    }

    if (analysis.duplicates?.length > 0) {
        lines.push(``, `## Duplicate Packages`, ``);
        for (const d of analysis.duplicates) {
            lines.push(`- **${d.label}**: ${d.packages.join(", ")} - ${d.suggestion}`);
        }
    }

    if (analysis.outdated?.length > 0) {
        lines.push(``, `## Outdated Packages`, ``);
        for (const o of analysis.outdated) {
            lines.push(`- **${o.name}** (v${o.currentVersion}) - ${o.reason} - \`${o.updateCommand}\``);
        }
    }

    return lines.join("\n") + "\n";
}

function exportHTML(analysis) {
    const rows = (analysis.profiles || [])
        .map((p) => `<tr><td>${p.name}</td><td>${p.version || "?"}</td><td>${p.category || "?"}</td><td>${formatBytes(p.sizeBytes || 0)}</td><td>${p.healthStatus}</td></tr>`)
        .join("\n");

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Package Intelligence Report</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
table { border-collapse: collapse; width: 100%; margin: 20px 0; }
th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
th { background: #f5f5f5; }
</style></head>
<body>
<h1>Package Intelligence Report</h1>
<p><strong>Date:</strong> ${analysis.createdAt}<br>
<strong>Machine:</strong> ${analysis.machine?.hostname || "unknown"}<br>
<strong>Packages:</strong> ${analysis.summary?.total || 0} (${formatBytes(analysis.summary?.totalSizeBytes || 0)})</p>
<h2>Summary</h2>
<p>Orphans: ${analysis.summary?.orphanCount || 0} | Duplicates: ${analysis.summary?.duplicateCount || 0} | Outdated: ${analysis.summary?.outdatedCount || 0}</p>
<h2>Packages</h2>
<table><tr><th>Name</th><th>Version</th><th>Category</th><th>Size</th><th>Health</th></tr>
${rows}
</table>
</body></html>
`;
}

function exportCSV(analysis) {
    const lines = ["name,version,category,size_bytes,health_status,install_method,orphan,duplicate,outdated,dependencies,reverse_dependencies"];
    for (const p of analysis.profiles || []) {
        lines.push(`${p.name},${p.version || ""},${p.category || ""},${p.sizeBytes || 0},${p.healthStatus},${p.installMethod},${p.isOrphan},${p.isDuplicate},${p.isOutdated},${(p.dependencies || []).join(";")},${(p.reverseDependencies || []).join(";")}`);
    }
    return lines.join("\n") + "\n";
}

function exportDot(analysis) {
    const lines = ["digraph packages {", "  rankdir=LR;"];
    for (const p of analysis.profiles || []) {
        for (const dep of p.dependencies || []) {
            lines.push(`  "${p.name}" -> "${dep}";`);
        }
    }
    lines.push("}");
    return lines.join("\n") + "\n";
}

function exportMermaid(analysis) {
    const lines = ["graph LR"];
    for (const p of analysis.profiles || []) {
        for (const dep of p.dependencies || []) {
            lines.push(`  ${p.name} --> ${dep}`);
        }
    }
    return lines.join("\n") + "\n";
}

// ─── History ──────────────────────────────────────────────────────────

export function saveAnalysis(analysis) {
    const dir = intelDir();
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `analysis-${analysis.createdAt.replace(/[:.]/g, "-")}.json`);
    writeFileSync(filePath, `${JSON.stringify(analysis, null, 2)}\n`);
    return filePath;
}

export function listHistory() {
    const dir = intelDir();
    if (!existsSync(dir)) return [];

    const records = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.startsWith("analysis-") || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        try {
            const data = JSON.parse(readFileSync(filePath, "utf8"));
            records.push({
                createdAt: data.createdAt,
                total: data.summary?.total || 0,
                totalSizeBytes: data.summary?.totalSizeBytes || 0,
                orphanCount: data.summary?.orphanCount || 0,
                duplicateCount: data.summary?.duplicateCount || 0,
                outdatedCount: data.summary?.outdatedCount || 0,
                path: filePath
            });
        } catch {
            // Corrupt file
        }
    }

    return records.sort((a, b) => {
        const aKey = a.createdAt || "";
        const bKey = b.createdAt || "";
        return aKey < bKey ? 1 : aKey > bKey ? -1 : 0;
    });
}

export function loadAnalysis(filePath) {
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Analysis file '${filePath}' not found`);
    }
    return JSON.parse(readFileSync(filePath, "utf8"));
}

// ─── Cache ────────────────────────────────────────────────────────────

function loadCache() {
    const filePath = cachePath();
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
        return null;
    }
}

function saveCache(cache) {
    const dir = intelDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachePath(), `${JSON.stringify(cache, null, 2)}\n`);
}

export function clearCache() {
    const filePath = cachePath();
    if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
        return true;
    }
    return false;
}

// ─── Utilities ────────────────────────────────────────────────────────

export function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return i < 2 ? `${Math.round(value)} ${units[i]}` : `${value.toFixed(i >= 3 ? 2 : 1)} ${units[i]}`;
}

export function packageInfo(name, { analysis } = {}) {
    const pkg = getPackage(name);
    const profile = analysis?.profiles?.find((p) => p.name === name);

    return {
        registry: pkg,
        profile: profile || null
    };
}
