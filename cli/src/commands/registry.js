// Native command: the Registry Builder (see
// docs/PlatformArchitecture.md section 3 / "Registry Builder") plus
// registry analytics ("registry stats"). Rebuilds the compiled
// registry.json index and the auto-generated docs/Registry.md catalog
// from the hand-authored registry/{categories,packages,collections,
// profiles,recipes} YAML sources - the one artifact a future hosted/
// remote registry would eventually serve, and a convenient single-file
// index for anything that wants to browse the catalog without parsing
// 100+ YAML files.
import { writeFileSync, readFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadRegistry, getRegistryStats, expandProfile, expandRecipe, loadPackages, clearRegistryCache } from "../core/registry.js";
import { loadCompatibilityRuleFiles } from "../core/compatibility/rules.js";
import { repoRoot } from "../core/paths.js";
import { table, section, healthBar } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling } from "../core/errors.js";
import { verifyAllPackages, registryDoctor, INSTALL_STATUS } from "../core/installAudit.js";
import { formatRegistry } from "../core/registryFormat.js";
import { lintRegistry } from "../core/registryLint.js";
import chalk from "chalk";

// compatibilityCoverage(packages) -> % of registry packages that have a
// dedicated registry/compatibility/<name>.yaml rule file authored for them
// (Compatibility Engine, v1.2.5) - the same "average of a per-component
// signal" shape as getRegistryStats' qualityScore, kept in the command
// layer rather than core/registry.js itself to avoid a circular import
// (core/compatibility/rules.js already imports loadPackages from
// core/registry.js).
export function compatibilityCoverage(packages) {
    if (packages.length === 0) return 100;
    const covered = new Set(loadCompatibilityRuleFiles().map((r) => r.name));
    return Math.round((packages.filter((p) => covered.has(p.name)).length / packages.length) * 100);
}

// computeRegistryAudit(data) -> a curated health scorecard + actionable
// recommendations (v2.1.1 Registry Excellence), distinct from the three
// commands above rather than a fourth overlapping one: `stats` is raw
// analytics, `verify` actually runs installs (slow, machine-dependent),
// `doctor` dumps every individual structural issue found. `audit` is the
// one static (no live installs), curated "is this registry in good
// shape, and what's the highest-leverage thing to fix" view - every
// number here is either read straight from getRegistryStats/
// registryDoctor or computed as a simple coverage percentage over real
// package fields, never fabricated.
function pct(count, total) {
    return total === 0 ? 100 : Math.round((count / total) * 100);
}

export function computeRegistryAudit(data) {
    const { packages } = data;
    const stats = getRegistryStats(data);
    const { issues: doctorIssues } = registryDoctor({ packages });
    const total = packages.length;

    const deprecatedCount = packages.filter((p) => p.stability === "deprecated").length;
    const brokenMetadataCount = new Set(
        doctorIssues.filter((i) => i.severity === "error").map((i) => i.package)
    ).size;
    const documentationCoverage = pct(packages.filter((p) => p.documentation).length, total);
    const validationCoverage = pct(packages.filter((p) => p.validate).length, total);
    const aliasesCoverage = pct(packages.filter((p) => (p.aliases || []).length > 0).length, total);
    const architectureCoverage = pct(packages.filter((p) => (p.architectures || []).length > 0).length, total);
    const compatCoverage = compatibilityCoverage(packages);

    const recommendations = [];
    if (aliasesCoverage < 50) {
        const missing = total - packages.filter((p) => (p.aliases || []).length > 0).length;
        recommendations.push(`${missing} package(s) have no aliases - add common short-name aliases where one genuinely exists (e.g. 'rg' for ripgrep).`);
    }
    if (compatCoverage < 25) {
        const missing = total - Math.round((compatCoverage / 100) * total);
        recommendations.push(`${missing} package(s) have no compatibility rule - consider declaring real conflicts/recommends for well-known pairings (see docs/RuleSchema.md).`);
    }
    if (architectureCoverage < 90) {
        const missing = total - packages.filter((p) => (p.architectures || []).length > 0).length;
        recommendations.push(`${missing} package(s) don't declare supported architectures - add 'architectures' so compatibility checks can catch CPU mismatches.`);
    }
    if (stats.ciVerifiedCount < total * 0.1) {
        recommendations.push(`Only ${stats.ciVerifiedCount} package(s) are CI-verified - consider adding more to .github/workflows/registry-smoke.yml's live-tested allowlist.`);
    }
    if (deprecatedCount > 0) {
        const withoutReplacement = packages.filter((p) => p.stability === "deprecated" && !(p.recommendedAlternatives || []).length).length;
        if (withoutReplacement > 0) {
            recommendations.push(`${withoutReplacement} deprecated package(s) have no recommendedAlternatives - add one so users know what to switch to.`);
        }
    }

    return {
        total,
        verified: stats.ciVerifiedCount,
        untested: total - stats.ciVerifiedCount,
        deprecated: deprecatedCount,
        brokenMetadata: brokenMetadataCount,
        averageQuality: stats.qualityScore,
        compatibilityCoverage: compatCoverage,
        documentationCoverage,
        validationCoverage,
        aliasesCoverage,
        architectureCoverage,
        recommendations
    };
}

// ENV_NEEDING_CATEGORIES - a small, honest heuristic (not a blanket
// requirement) for computeCrossPlatformAudit's "Missing environment"
// count. Most CLI tools genuinely need zero PATH/variable configuration
// beyond what brew/apt/npm already wire up - only 2/261 packages
// declared `environment` as of the Registry Completion milestone
// (java, go), both real SDKs with a JAVA_HOME/GOPATH-style need.
// Fabricating an `environment` stanza for a package that doesn't need
// one (e.g. `bat`) would be dishonest data, not completeness - so this
// only flags packages whose category structurally implies the need
// (language toolchains/SDKs, mobile development) as "missing" when they
// don't have one; every other package's absence is correctly counted as
// "not applicable," not a gap.
const ENV_NEEDING_CATEGORIES = new Set(["languages", "mobile-development", "apple-development"]);

// REQUIRED_MISSING_FIELDS - the subset of computeCrossPlatformAudit's
// `missing` counts that make `registry audit`/`--check-regression` exit
// non-zero (the CI gate): the four core lifecycle commands every package
// genuinely needs (install/validate/uninstall/upgrade). repair/binary/
// version/dependencies/conflicts/environment are real completeness
// signals too, but are legitimately optional for some packages (not
// every tool has a repair command; not every tool needs env vars) so
// they're reported, not gated.
const REQUIRED_MISSING_FIELDS = ["install", "validate", "uninstall", "upgrade"];

// platformEntryStatus(pkg, platformId) -> "supported" | "unsupported" |
// "gap". Mirrors installer.js's resolvePlatformInstall() but is
// parameterized by an explicit platformId (not the live getPlatform()
// singleton) so the audit can check all three platforms in one pass
// regardless of which OS is actually running it. macOS alone still
// honors the historical implicit fallback to the top-level `install`
// field (every package has always had one); Linux/Windows must be
// explicit under Registry Completion - an absent key is a real "gap,"
// never silently treated as "this platform is fine."
function platformEntryStatus(pkg, platformId) {
    const source = pkg.variants ? pkg.variants[0] : pkg;
    const entry = source.platformInstall?.[platformId];
    if (entry) {
        // entry is one of: a single installStep, an array of installSteps
        // (one per package manager - apt+dnf+pacman, winget+choco+scoop),
        // or an explicit { unsupported, reason } declaration. Only the
        // last one is a non-gap "unsupported" - an array is real coverage.
        return Array.isArray(entry) || !entry.unsupported ? "supported" : "unsupported";
    }
    if (platformId === "macos" && source.install) return "supported";
    return "gap";
}

// computeCrossPlatformAudit(packages) -> the Registry Completion
// scorecard (v3.0 milestone): per-platform coverage (every package must
// explicitly resolve or explicitly decline, not be silently omitted),
// plus a validation pass over the fields every complete manifest needs.
// Every count here is a real, deterministic read of registry data -
// never estimated.
export function computeCrossPlatformAudit(packages) {
    const total = packages.length;
    const platforms = ["macos", "linux", "windows"];
    const crossPlatform = {};
    const gapsByPlatform = {};
    let unsupportedPackages = 0;

    for (const platformId of platforms) {
        let handled = 0;
        const gaps = [];
        for (const pkg of packages) {
            const status = platformEntryStatus(pkg, platformId);
            if (status !== "gap") handled++;
            else gaps.push(pkg.name);
        }
        crossPlatform[platformId] = { handled, total, gaps };
        gapsByPlatform[platformId] = gaps;
    }

    for (const pkg of packages) {
        if (platforms.some((p) => platformEntryStatus(pkg, p) === "unsupported")) {
            unsupportedPackages++;
        }
    }

    const missing = {
        install: packages.filter((p) => !p.install && !p.variants).map((p) => p.name),
        validate: packages.filter((p) => !p.validate).map((p) => p.name),
        uninstall: packages.filter((p) => !p.uninstall).map((p) => p.name),
        upgrade: packages.filter((p) => !p.update).map((p) => p.name),
        repair: packages.filter((p) => !p.repair).map((p) => p.name),
        version: packages.filter((p) => !p.versionCommand).map((p) => p.name),
        binary: packages.filter((p) => !p.binary && !p.versionCommand && !p.validate).map((p) => p.name),
        // dependencies/conflicts: "missing" means the field was never
        // explicitly declared (not even as []) - Registry Completion's
        // "explicit and intentional" rule applied to these two fields
        // specifically, matching how every package already explicitly
        // declares `dependencies: []`/`conflicts: []` when it has none,
        // rather than silently omitting the key.
        dependencies: packages.filter((p) => !("dependencies" in p)).map((p) => p.name),
        conflicts: packages.filter((p) => !("conflicts" in p)).map((p) => p.name),
        environment: packages.filter((p) => ENV_NEEDING_CATEGORIES.has(p.category) && !p.environment).map((p) => p.name)
    };

    return {
        total,
        crossPlatform,
        unsupportedPackages,
        missing: Object.fromEntries(Object.entries(missing).map(([k, v]) => [k, v.length])),
        missingDetail: missing
    };
}

// dependencyDepth(name, byName) -> the length of the longest dependency
// chain starting at `name` (0 for a leaf with no dependencies). Memoized
// across the whole call so computing every package's depth is O(n), not
// O(n^2); a `visiting` guard makes a cycle degrade to depth 0 for the
// cycle's members instead of infinite-looping (the registry is already
// lint-verified acyclic, but this must never hang if that ever regresses).
function dependencyDepth(name, byName, memo, visiting = new Set()) {
    if (memo.has(name)) return memo.get(name);
    if (visiting.has(name)) return 0;
    const pkg = byName.get(name);
    const deps = pkg?.dependencies || [];
    if (deps.length === 0) {
        memo.set(name, 0);
        return 0;
    }
    visiting.add(name);
    const depth = 1 + Math.max(...deps.map((d) => dependencyDepth(d, byName, memo, visiting)));
    visiting.delete(name);
    memo.set(name, depth);
    return depth;
}

// computeRegistryInventory(packages) -> the breakdown view `registry
// stats` adds on top of computeRegistryAudit's summary numbers: which
// package managers/categories/platforms are actually in use, which
// packages contribute Environment Configuration Engine metadata, and
// how deep the dependency graph runs on average. Every count here reads
// a real field - "by language" specifically means packages tagged
// 'language' (the tag this registry's language packages already use,
// e.g. java.yaml's `tags: [language, jvm]`), not a fabricated field.
export function computeRegistryInventory(packages) {
    const byName = new Map(packages.map((p) => [p.name, p]));

    const packageManagers = {};
    for (const pkg of packages) {
        const method = pkg.install?.method || pkg.variants?.[0]?.install?.method;
        if (method) packageManagers[method] = (packageManagers[method] || 0) + 1;
    }

    const byCategory = {};
    for (const pkg of packages) {
        if (pkg.category) byCategory[pkg.category] = (byCategory[pkg.category] || 0) + 1;
    }

    const byPlatform = { macos: 0, linux: 0, windows: 0 };
    for (const pkg of packages) {
        for (const platformId of pkg.platforms || []) {
            if (platformId in byPlatform) byPlatform[platformId]++;
        }
    }

    const languagePackages = packages.filter((p) => (p.tags || []).includes("language")).map((p) => p.name).sort();

    const environmentContributors = packages.filter((p) => p.environment).map((p) => p.name).sort();

    const memo = new Map();
    const depths = packages.map((p) => dependencyDepth(p.name, byName, memo));
    const averageDependencyDepth = depths.length === 0 ? 0 : Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 100) / 100;
    const maxDependencyDepth = depths.length === 0 ? 0 : Math.max(...depths);

    const unsupportedPackages = packages.filter((p) => ["macos", "linux", "windows"].some((platformId) => platformEntryStatus(p, platformId) === "unsupported")).map((p) => p.name).sort();

    return {
        packageManagers,
        byCategory,
        byPlatform,
        languagePackages,
        environmentContributors,
        averageDependencyDepth,
        maxDependencyDepth,
        unsupportedPackages
    };
}

// baselineFromAudit(audit) -> the small, checked-in-friendly shape
// registry/completeness-baseline.json stores - just the counts, not the
// per-package gap lists (those change too often to be a meaningful diff
// target and would make the baseline file noisy to review).
export function baselineFromAudit(audit) {
    return {
        total: audit.total,
        crossPlatform: {
            macos: audit.crossPlatform.macos.handled,
            linux: audit.crossPlatform.linux.handled,
            windows: audit.crossPlatform.windows.handled
        },
        missing: { ...audit.missing }
    };
}

// compareCrossPlatformBaseline(audit, baseline) -> { ok, regressions }.
// The CI gate (Registry Completion milestone): a PR must never lower
// macOS/Linux/Windows coverage or raise a "missing X" count below what's
// already checked in - registry data only gets more complete over time,
// the same one-way ratchet docs/registry.json's "must not drift" CI
// check already enforces for generated artifacts. Improving a number is
// always allowed and expected; `--write-baseline` is how you record it.
export function compareCrossPlatformBaseline(audit, baseline) {
    const regressions = [];
    if (audit.total !== baseline.total) {
        regressions.push(`Package count changed: baseline ${baseline.total} -> now ${audit.total} (informational - not itself a failure, but re-run --write-baseline)`);
    }
    for (const platformId of ["macos", "linux", "windows"]) {
        const now = audit.crossPlatform[platformId].handled;
        const was = baseline.crossPlatform[platformId];
        if (now < was) {
            regressions.push(`${platformId} coverage regressed: ${was} -> ${now} handled (out of ${audit.total})`);
        }
    }
    for (const field of Object.keys(baseline.missing)) {
        const now = audit.missing[field] ?? 0;
        const was = baseline.missing[field];
        if (now > was) {
            regressions.push(`Missing ${field} increased: ${was} -> ${now}`);
        }
    }
    return { ok: regressions.filter((r) => !r.includes("informational")).length === 0, regressions };
}

function buildCompiledRegistry({ categories, packages, collections, profiles, recipes }) {
    const sortedCategories = [...categories].sort((a, b) => a.id.localeCompare(b.id));
    const sortedPackages = [...packages].sort((a, b) => a.name.localeCompare(b.name));
    const sortedCollections = [...collections].sort((a, b) => a.name.localeCompare(b.name));
    const sortedProfiles = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
    const sortedRecipes = [...recipes].sort((a, b) => a.name.localeCompare(b.name));

    const searchIndex = sortedPackages.map((p) => ({
        name: p.name,
        category: p.category,
        description: p.description,
        tags: p.tags || [],
        aliases: p.aliases || []
    }));

    return {
        schemaVersion: 1,
        categories: sortedCategories,
        packages: sortedPackages,
        collections: sortedCollections,
        profiles: sortedProfiles,
        recipes: sortedRecipes,
        searchIndex
    };
}

function buildDocsMarkdown({ categories, packages, collections, profiles, recipes }) {
    const sortedCategories = [...categories].sort((a, b) => a.id.localeCompare(b.id));
    const sortedCollections = [...collections].sort((a, b) => a.name.localeCompare(b.name));
    const sortedProfiles = [...profiles].sort((a, b) => a.name.localeCompare(b.name));
    const sortedRecipes = [...recipes].sort((a, b) => a.name.localeCompare(b.name));
    const byCategory = new Map(sortedCategories.map((c) => [c.id, []]));
    for (const pkg of [...packages].sort((a, b) => a.name.localeCompare(b.name))) {
        (byCategory.get(pkg.category) || byCategory.set(pkg.category, []).get(pkg.category)).push(pkg);
    }

    const lines = [
        "# Registry",
        "",
        "AUTO-GENERATED by `devforgekit registry generate` from `registry/categories`,",
        "`registry/packages`, `registry/collections`, and `registry/profiles` - do not",
        "hand-edit; changes are overwritten on the next generate. See",
        "[PlatformArchitecture.md](PlatformArchitecture.md).",
        "",
        `${packages.length} components across ${categories.length} categories, ${collections.length} collections, ${profiles.length} profiles, ${recipes.length} recipes.`,
        ""
    ];

    for (const category of sortedCategories) {
        const members = byCategory.get(category.id) || [];
        lines.push(`## ${category.label}`, "", category.description, "");
        for (const pkg of members) {
            const homepage = pkg.homepage ? ` - [${pkg.homepage}](${pkg.homepage})` : "";
            lines.push(`- **${pkg.name}** - ${pkg.description}${homepage}`);
        }
        // A memberless category would otherwise emit two consecutive
        // blank lines (markdownlint MD012).
        if (members.length > 0) lines.push("");
    }

    lines.push("## Collections", "");
    for (const c of sortedCollections) {
        lines.push(`- **${c.name}** - ${c.description}: ${c.components.join(", ")}`);
    }
    lines.push("");

    lines.push("## Profiles", "");
    for (const p of sortedProfiles) {
        lines.push(`- **${p.name}** - ${p.description}: ${expandProfile(p).join(", ")}`);
    }
    lines.push("");

    lines.push("## Recipes", "");
    for (const r of sortedRecipes) {
        lines.push(`- **${r.icon ? `${r.icon} ` : ""}${r.name}** - ${r.description}: ${expandRecipe(r).join(", ")}`);
    }
    lines.push("");

    return lines.join("\n");
}

// buildBrewfileCategories(packages, categories, brewfileContent) -> the
// plain-text, bash-parseable category manifest the Layer 1 install wizard
// (scripts/install_wizard.sh) reads for its Custom category checklist.
// Single source of truth stays the registry's own `category` field
// (already validated, already what Layer 2 profiles/recipes use) - this
// is a *generated* artifact, same discipline as registry.json/Registry.md,
// so Layer 1 never needs a YAML parser or a second, hand-maintained
// category taxonomy. Only `brew`/`cask` lines are categorized (`vscode`/
// `npm`/`tap` lines aren't install-wizard checklist items). Every
// registry installStep that installs via Homebrew (top-level `install`,
// `platformInstall.macos`, and the same two shapes on every `variants[]`
// entry) contributes its id -> category mapping; a Brewfile package with
// no matching registry manifest falls into "other" rather than being
// silently dropped. Package descriptions are the same registry
// `description` field; category descriptions/labels come from
// `registry/categories/*.yaml` (an "other" pseudo-category, not a real
// registry entry, gets a fixed description below since it exists only to
// hold uncategorized Brewfile packages).
export function buildBrewfileCategories(packages, categories, brewfileContent) {
    const idToCategory = new Map();
    const collectInstallStep = (step, pkg) => {
        if (!step || !step.id) return;
        if (step.method !== "brew-formula" && step.method !== "brew-cask") return;
        if (!idToCategory.has(step.id)) {
            idToCategory.set(step.id, { category: pkg.category, description: pkg.description });
        }
    };
    for (const pkg of packages) {
        collectInstallStep(pkg.install, pkg);
        collectInstallStep(pkg.platformInstall?.macos, pkg);
        for (const variant of pkg.variants || []) {
            collectInstallStep(variant.install, pkg);
            collectInstallStep(variant.platformInstall?.macos, pkg);
        }
    }

    const categoryById = new Map(categories.map((c) => [c.id, c]));
    categoryById.set("other", { id: "other", label: "Other", description: "Everything else - no matching registry category yet." });

    const entries = [];
    const uncategorized = [];
    const usedCategories = new Set();
    const seenTypeId = new Set();
    const lineRe = /^\s*(brew|cask)\s+"([^"]+)"/;
    for (const rawLine of brewfileContent.split("\n")) {
        const match = rawLine.match(lineRe);
        if (!match) continue;
        const [, type, id] = match;
        // brewfileContent is the union of the root Brewfile + every
        // profiles/*/Brewfile (see the `generate` action below) - the
        // same package (e.g. "git") appears in several of them, so
        // dedupe by (type, id) rather than emitting one manifest line
        // per profile that happens to list it.
        const key = `${type}|${id}`;
        if (seenTypeId.has(key)) continue;
        seenTypeId.add(key);
        const known = idToCategory.get(id);
        const category = known?.category || "other";
        const description = known?.description || "";
        entries.push({ category, type, id, description });
        usedCategories.add(category);
        if (!known) uncategorized.push(id);
    }

    entries.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));

    const header = [
        "# AUTO-GENERATED by `devforgekit registry generate` from the root Brewfile",
        "# plus every profiles/*/Brewfile (union, deduplicated), cross-referenced",
        "# against registry/packages/*.yaml's `category` field and",
        "# registry/categories/*.yaml's label/description.",
        "# Do not hand-edit; changes are overwritten on the next generate.",
        "# Category description lines: @category|id|label|description",
        "# Package lines: category|brew-or-cask|id|description"
    ];
    const categoryLines = [...usedCategories].sort().map((id) => {
        const c = categoryById.get(id) || { label: id, description: "" };
        return `@category|${id}|${c.label}|${c.description}`;
    });
    const body = entries.map((e) => `${e.category}|${e.type}|${e.id}|${e.description}`);

    return { text: `${[...header, ...categoryLines, ...body].join("\n")}\n`, uncategorized };
}

export function registerRegistryCommand(program) {
    const registry = program
        .command("registry")
        .description("Rebuild the registry index/docs, or show registry analytics");

    registry
        .command("generate")
        .description("Validate every manifest (including cross-references) and regenerate registry.json + docs/Registry.md")
        .action(withErrorHandling(async () => {
            const data = loadRegistry();

            const registryJsonPath = path.join(repoRoot(), "registry", "registry.json");
            const docsPath = path.join(repoRoot(), "docs", "Registry.md");
            const brewfileCategoriesPath = path.join(repoRoot(), "profiles", "generated", "brewfile-categories.txt");

            writeFileSync(registryJsonPath, `${JSON.stringify(buildCompiledRegistry(data), null, 2)}\n`);
            writeFileSync(docsPath, buildDocsMarkdown(data));

            // Union the root Brewfile with every profiles/<name>/Brewfile
            // (minimal/recommended/backend/flutter/custom/...) - a
            // profile can list a package (e.g. recommended's `cask
            // "docker"`) that the root Brewfile itself doesn't have, and
            // the category manifest needs to cover every package any
            // tier might reference, not just root's. buildBrewfileCategories
            // dedupes by (type, id) across the union.
            const profilesDir = path.join(repoRoot(), "profiles");
            const profileBrewfiles = readdirSync(profilesDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => path.join(profilesDir, entry.name, "Brewfile"))
                .filter((p) => { try { readFileSync(p); return true; } catch { return false; } });
            const brewfileContent = [
                readFileSync(path.join(repoRoot(), "Brewfile"), "utf8"),
                ...profileBrewfiles.map((p) => readFileSync(p, "utf8"))
            ].join("\n");
            const { text: brewfileCategoriesText, uncategorized } = buildBrewfileCategories(data.packages, data.categories, brewfileContent);
            mkdirSync(path.dirname(brewfileCategoriesPath), { recursive: true });
            writeFileSync(brewfileCategoriesPath, brewfileCategoriesText);
            if (uncategorized.length > 0) {
                logger.warn(`${uncategorized.length} Brewfile package(s) have no matching registry manifest, filed under "other": ${uncategorized.join(", ")}`);
            }

            clearRegistryCache();

            logger.success(`Generated registry/registry.json (${data.packages.length} packages, ${data.categories.length} categories, ${data.collections.length} collections, ${data.profiles.length} profiles, ${data.recipes.length} recipes)`);
            logger.success("Generated docs/Registry.md");
            logger.success("Generated profiles/generated/brewfile-categories.txt");
        }));

    registry
        .command("stats")
        .description("Registry analytics: totals, dependency graph, package manager/category/platform breakdown, duplicate aliases, orphaned manifests, metadata completeness")
        .option("--json", "emit as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const data = loadRegistry();
            const stats = { ...getRegistryStats(data), compatibilityCoverage: compatibilityCoverage(data.packages) };
            const inventory = computeRegistryInventory(data.packages);

            if (opts.json) {
                console.log(JSON.stringify({ ...stats, ...inventory }, null, 2));
                return;
            }

            console.log(section("Registry Analytics", [
                healthBar(stats.qualityScore),
                "",
                `Components:  ${stats.totalComponents}`,
                `Categories:  ${stats.totalCategories}`,
                `Collections: ${stats.totalCollections}`,
                `Profiles:    ${stats.totalProfiles}`,
                `Recipes:     ${stats.totalRecipes}`,
                `Dependency edges: ${stats.dependencyEdges}`,
                `Most depended-upon: ${stats.mostDependedUpon ? `${stats.mostDependedUpon.name} (${stats.mostDependedUpon.count} dependents)` : "none"}`,
                `Largest bundle: ${stats.largestBundle ? `${stats.largestBundle.kind} '${stats.largestBundle.name}' (${stats.largestBundle.size} components)` : "none"}`,
                `Metadata completeness: ${stats.metadataCompletenessScore}%`,
                `CI-verified components (live install/validate/uninstall smoke test): ${stats.ciVerifiedCount}`,
                `Compatibility rule coverage (registry/compatibility/*.yaml): ${stats.compatibilityCoverage}%`
            ]));

            if (stats.duplicateAliases.length > 0) {
                console.log(`\n${chalk.yellow(`Duplicate aliases (${stats.duplicateAliases.length})`)}`);
                console.log(table(
                    stats.duplicateAliases.map(({ alias, owners }) => ({ alias, owners: owners.join(", ") })),
                    [
                        { key: "alias", label: "ALIAS" },
                        { key: "owners", label: "CLAIMED BY", maxWidth: 45 }
                    ]
                ));
            } else {
                logger.success("No duplicate aliases");
            }

            if (stats.orphaned.length > 0) {
                logger.warn(`Orphaned manifests - not referenced by any collection/profile (${stats.orphaned.length}): ${stats.orphaned.join(", ")}`);
            } else {
                logger.success("No orphaned manifests");
            }

            const breakdownTable = (counts, labelHeader) => table(
                Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
                [{ key: "label", label: labelHeader }, { key: "count", label: "PACKAGES" }]
            );

            console.log(`\n${chalk.bold("Package managers in use")}`);
            console.log(breakdownTable(inventory.packageManagers, "METHOD"));

            console.log(`\n${chalk.bold("Packages by category")}`);
            console.log(breakdownTable(inventory.byCategory, "CATEGORY"));

            console.log(`\n${chalk.bold("Packages by platform")}`);
            console.log(breakdownTable(inventory.byPlatform, "PLATFORM"));

            console.log(section("Dependency graph & other breakdowns", [
                `Average dependency depth: ${inventory.averageDependencyDepth}`,
                `Max dependency depth: ${inventory.maxDependencyDepth}`,
                `Packages tagged 'language': ${inventory.languagePackages.length}`,
                `Environment Configuration Engine contributors: ${inventory.environmentContributors.length}${inventory.environmentContributors.length > 0 ? ` (${inventory.environmentContributors.join(", ")})` : ""}`,
                `Unsupported-on-some-platform packages: ${inventory.unsupportedPackages.length}${inventory.unsupportedPackages.length > 0 ? ` (${inventory.unsupportedPackages.slice(0, 10).join(", ")}${inventory.unsupportedPackages.length > 10 ? ", ..." : ""})` : ""}`
            ]));
        }));

    registry
        .command("verify")
        .description("Check every registry package's install status. Read-only by default (validates what's already installed) - pass --install to actually attempt installing missing packages.")
        .option("--json", "emit results as JSON")
        .option("--install", "attempt to actually install packages that aren't already present (mutates the machine - default is read-only)")
        .option("--timeout <ms>", "per-package install timeout in milliseconds, only relevant with --install", "120000")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const packages = loadPackages();
            const timeoutMs = parseInt(opts.timeout, 10) || 120000;
            const attemptInstall = Boolean(opts.install);

            if (!opts.json) {
                logger.section(`Verifying ${packages.length} registry packages...${attemptInstall ? " (--install: will attempt real installs for missing packages)" : ""}`);
            }

            const { results, summary } = await verifyAllPackages({
                packages,
                timeoutMs,
                attemptInstall,
                onProgress: opts.json ? undefined : (r) => {
                    if (r.status === INSTALL_STATUS.NOT_INSTALLED) {
                        logger.info(`○ ${r.name} - not installed`);
                        return;
                    }
                    const icon = r.success ? "✓" : "✗";
                    const status = r.success ? "verified" : r.status;
                    if (r.success) {
                        logger.success(`${icon} ${r.name} - ${status}`);
                    } else {
                        logger.error(`${icon} ${r.name} - ${status}: ${r.failureMessage || "failed"}`);
                        if (r.suggestedFix) {
                            console.log(`    Fix: ${r.suggestedFix}`);
                        }
                    }
                }
            });

            if (opts.json) {
                console.log(JSON.stringify({ results, summary }, null, 2));
                return;
            }

            console.log(section("Verification Summary", [
                healthBar(summary.reliability),
                "",
                `Total:                    ${summary.total}`,
                `✅ Verified:              ${summary.verified}`,
                `🟢 Installed:             ${summary.installed}`,
                `🔄 Update Available:      ${summary.updateAvailable}`,
                `○ Not Installed:          ${summary.notInstalled}${attemptInstall ? "" : " (pass --install to attempt real installs)"}`,
                `⚠ Manual Installation:    ${summary.manualInstallation}`,
                `🔐 Auth Required:         ${summary.authenticationRequired}`,
                `📄 License Required:      ${summary.licenseRequired}`,
                `📦 Missing Dependency:    ${summary.missingDependency}`,
                `🌐 Network Error:         ${summary.networkError}`,
                `⏱ Timeout:                ${summary.timeout}`,
                `🔧 Missing Pkg Manager:   ${summary.missingPackageManager}`,
                `🚫 Unsupported Platform:  ${summary.unsupportedPlatform}`,
                `🚫 Unsupported Arch:      ${summary.unsupportedArchitecture}`,
                `❌ Deprecated:            ${summary.deprecated}`,
                `❌ Broken Registry:       ${summary.brokenRegistryMetadata}`,
                `❌ Broken Download:       ${summary.brokenDownload}`,
                `❌ Removed by Vendor:     ${summary.removedByVendor}`,
                `⚠ Untested:               ${summary.untested}`
            ]));

            const problemCount = summary.brokenRegistryMetadata + summary.brokenDownload + summary.removedByVendor + summary.unsupportedPlatform + summary.unsupportedArchitecture;
            if (problemCount > 0) {
                logger.warn(`${problemCount} packages need attention.`);
            } else if (!attemptInstall && summary.notInstalled > 0) {
                logger.info(`${summary.notInstalled} package(s) not installed - run with --install to attempt real installs (mutates the machine).`);
            } else if (summary.verified + summary.installed === summary.total) {
                logger.success("All packages verified!");
            }
        }));

    registry
        .command("doctor")
        .description("Registry health check: broken formulas, missing commands, dead URLs, duplicates, untested packages")
        .option("--json", "emit results as JSON")
        .action(withErrorHandling(async function () {
            const opts = this.opts();
            const packages = loadPackages();

            const { issues, summary } = registryDoctor({ packages });

            if (opts.json) {
                console.log(JSON.stringify({ issues, summary }, null, 2));
                return;
            }

            console.log(section("Registry Health Report", [
                healthBar(summary.qualityScore),
                "",
                `Total packages:  ${summary.total}`,
                `Total issues:    ${summary.issues}`,
                `Errors:          ${summary.errors}`,
                `Warnings:        ${summary.warnings}`,
                `Info:            ${summary.info}`
            ]));

            if (issues.length === 0) {
                logger.success("No issues found - registry is healthy!");
                return;
            }

            const issueTable = (rows) => table(
                rows.map((i) => ({ package: i.package, message: i.message })),
                [
                    { key: "package", label: "PACKAGE" },
                    { key: "message", label: "MESSAGE", maxWidth: 55 }
                ]
            );

            const errors = issues.filter((i) => i.severity === "error");
            const warnings = issues.filter((i) => i.severity === "warning");

            if (errors.length > 0) {
                console.log(`\n${chalk.red(`Errors (${errors.length})`)}`);
                console.log(issueTable(errors));
            }

            if (warnings.length > 0) {
                console.log(`\n${chalk.yellow(`Warnings (${warnings.length})`)}`);
                console.log(issueTable(warnings));
            }

            const infos = issues.filter((i) => i.severity === "info");
            if (infos.length > 0) {
                console.log(`\n${chalk.dim(`Info (${infos.length})`)}`);
                console.log(issueTable(infos.slice(0, 20)));
                if (infos.length > 20) {
                    console.log(`  ... and ${infos.length - 20} more info items.`);
                }
            }
        }));

    registry
        .command("audit")
        .description("Registry health scorecard: coverage percentages across documentation/validation/aliases/architecture/compatibility, plus actionable recommendations")
        .option("--json", "emit the scorecard as JSON")
        .option("--platforms-only", "show only the Registry Completion cross-platform/validation report")
        .option("--check-regression <file>", "compare against a baseline JSON (registry/completeness-baseline.json) and exit 1 if coverage regressed - the CI gate")
        .option("--write-baseline <file>", "write the current cross-platform/validation counts to a baseline JSON file")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const data = loadRegistry();
            const audit = computeRegistryAudit(data);
            const crossPlatform = computeCrossPlatformAudit(data.packages);

            if (opts.writeBaseline) {
                const baseline = baselineFromAudit(crossPlatform);
                writeFileSync(opts.writeBaseline, `${JSON.stringify(baseline, null, 2)}\n`);
                logger.success(`Wrote baseline to ${opts.writeBaseline}`);
                return;
            }

            if (opts.checkRegression) {
                const baseline = JSON.parse(readFileSync(opts.checkRegression, "utf8"));
                const result = compareCrossPlatformBaseline(crossPlatform, baseline);
                if (result.ok) {
                    logger.success(`Registry completeness has not regressed (macOS ${crossPlatform.crossPlatform.macos.handled}, Linux ${crossPlatform.crossPlatform.linux.handled}, Windows ${crossPlatform.crossPlatform.windows.handled} / ${crossPlatform.total}).`);
                } else {
                    logger.error("Registry completeness regressed:");
                    for (const r of result.regressions) logger.error(`  - ${r}`);
                    process.exitCode = 1;
                }
                return;
            }

            if (opts.json) {
                console.log(JSON.stringify(opts.platformsOnly ? crossPlatform : { ...audit, crossPlatform }, null, 2));
                if (REQUIRED_MISSING_FIELDS.some((f) => crossPlatform.missing[f] > 0)) process.exitCode = 1;
                return;
            }

            console.log(section("Registry Health", [
                `Packages: ${crossPlatform.total}`
            ]));
            console.log(`\n${chalk.bold("Cross Platform")}`);
            console.log(table(
                [
                    { platform: "macOS", coverage: `${crossPlatform.crossPlatform.macos.handled} / ${crossPlatform.total}` },
                    { platform: "Linux", coverage: `${crossPlatform.crossPlatform.linux.handled} / ${crossPlatform.total}` },
                    { platform: "Windows", coverage: `${crossPlatform.crossPlatform.windows.handled} / ${crossPlatform.total}` }
                ],
                [
                    { key: "platform", label: "" },
                    { key: "coverage", label: "COVERAGE" }
                ]
            ));
            console.log(`\n${chalk.bold("Validation")}`);
            console.log(table(
                [
                    { field: "Missing install method", count: crossPlatform.missing.install },
                    { field: "Missing validate", count: crossPlatform.missing.validate },
                    { field: "Missing uninstall", count: crossPlatform.missing.uninstall },
                    { field: "Missing upgrade method", count: crossPlatform.missing.upgrade },
                    { field: "Missing repair method", count: crossPlatform.missing.repair },
                    { field: "Missing version", count: crossPlatform.missing.version },
                    { field: "Missing binary", count: crossPlatform.missing.binary },
                    { field: "Missing dependencies", count: crossPlatform.missing.dependencies },
                    { field: "Missing conflicts", count: crossPlatform.missing.conflicts },
                    { field: "Missing environment", count: crossPlatform.missing.environment },
                    { field: "Unsupported packages", count: crossPlatform.unsupportedPackages }
                ],
                [
                    { key: "field", label: "" },
                    { key: "count", label: "COUNT" }
                ]
            ));
            for (const platformId of ["linux", "windows", "macos"]) {
                const gaps = crossPlatform.crossPlatform[platformId].gaps;
                if (gaps.length > 0) {
                    console.log(`\n${chalk.yellow(`${platformId} gaps (${gaps.length})`)}: ${gaps.slice(0, 10).join(", ")}${gaps.length > 10 ? `, ... and ${gaps.length - 10} more` : ""}`);
                }
            }
            if (REQUIRED_MISSING_FIELDS.some((f) => crossPlatform.missing[f] > 0)) {
                process.exitCode = 1;
            }

            if (opts.platformsOnly) return;

            console.log(section("Registry Audit", [
                healthBar(audit.averageQuality),
                "",
                `Packages:                ${audit.total}`,
                `Verified (CI):           ${audit.verified} (${pct(audit.verified, audit.total)}%)`,
                `Untested:                ${audit.untested} (${pct(audit.untested, audit.total)}%)`,
                `Deprecated:              ${audit.deprecated}`,
                `Broken Metadata:         ${audit.brokenMetadata}`
            ]));

            console.log(`\n${chalk.bold("Coverage")}`);
            console.log(table(
                [
                    { label: "Compatibility", value: `${audit.compatibilityCoverage}%` },
                    { label: "Documentation", value: `${audit.documentationCoverage}%` },
                    { label: "Validation", value: `${audit.validationCoverage}%` },
                    { label: "Aliases", value: `${audit.aliasesCoverage}%` },
                    { label: "Architecture", value: `${audit.architectureCoverage}%` }
                ],
                [
                    { key: "label", label: "" },
                    { key: "value", label: "COVERAGE" }
                ]
            ));

            if (audit.recommendations.length > 0) {
                console.log(section("Recommendations", audit.recommendations.map((rec) => `- ${rec}`)));
            } else {
                logger.success("No high-leverage gaps found.");
            }
        }));

    registry
        .command("format")
        .description("Normalize every registry/*.yaml file's key order, array style, and quoting to one canonical, deterministic form")
        .option("--check", "report which files would change without writing them (exit 1 if any would - the CI gate)")
        .option("--json", "emit the file list as JSON")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const results = formatRegistry({ check: Boolean(opts.check) });
            const changed = results.filter((r) => r.changed);

            if (opts.json) {
                console.log(JSON.stringify({ total: results.length, changed: changed.length, files: changed.map((c) => c.file) }, null, 2));
                if (opts.check && changed.length > 0) process.exitCode = 1;
                return;
            }

            if (changed.length === 0) {
                logger.success(`All ${results.length} registry files are already canonically formatted.`);
                return;
            }

            if (opts.check) {
                logger.error(`${changed.length} of ${results.length} registry file(s) are not canonically formatted:`);
                for (const c of changed) console.log(`  ${c.file}`);
                logger.info("Run 'devforgekit registry format' to fix.");
                process.exitCode = 1;
            } else {
                logger.success(`Formatted ${changed.length} of ${results.length} registry file(s):`);
                for (const c of changed) console.log(`  ${c.file}`);
            }
        }));

    registry
        .command("lint")
        .description("Structural checks: schema violations, duplicate IDs/binaries/aliases, cyclic dependencies, orphan packages")
        .option("--json", "emit findings as JSON")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const { errors, warnings } = lintRegistry();

            if (opts.json) {
                console.log(JSON.stringify({ errors, warnings }, null, 2));
                if (errors.length > 0) process.exitCode = 1;
                return;
            }

            if (errors.length === 0 && warnings.length === 0) {
                logger.success("Registry lint: no issues found.");
                return;
            }

            const findingTable = (rows) => table(
                rows.map((r) => ({ location: r.file || r.field || "-", type: r.type, message: r.message })),
                [
                    { key: "location", label: "LOCATION", maxWidth: 28 },
                    { key: "type", label: "TYPE" },
                    { key: "message", label: "MESSAGE", maxWidth: 55 }
                ]
            );

            if (errors.length > 0) {
                console.log(`\n${chalk.red(`Errors (${errors.length})`)}`);
                console.log(findingTable(errors));
            }
            if (warnings.length > 0) {
                console.log(`\n${chalk.yellow(`Warnings (${warnings.length})`)}`);
                console.log(findingTable(warnings));
            }
            if (errors.length > 0) process.exitCode = 1;
        }));
}
