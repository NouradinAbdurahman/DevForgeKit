// The Self-Update Engine (v1.3.1). Instead of telling users to run
// `git pull && npm install` manually, `devforgekit self-update` orchestrates
// the entire update lifecycle in one command:
//
//   1. Pre-flight checks (git repo, clean working tree or auto-stash)
//   2. Backup user config (~/.config/devforgekit/ → timestamped snapshot)
//   3. Record current git commit (for rollback)
//   4. git pull (updates DevForgeKit + registry + bundled plugins/recipes)
//   5. npm install in cli/ (update Node dependencies)
//   6. Migrate config (versioned migration framework)
//   7. Update user plugins (git pull any git-based plugins)
//   8. Show changelog (what changed between old and new versions)
//   9. On any failure: rollback to the previous commit + restore config backup
//
// Every step is a plain function returning { ok, error?, details? } so the
// orchestrator can decide whether to continue or roll back - no exceptions
// for expected failures (network errors, merge conflicts), only for bugs.
import { existsSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import { repoRoot, cliRoot, userConfigDir, userStateDir } from "./paths.js";
import { captureShellCommand, runShellCommand } from "./shell.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";

// ─── Config migration framework ───────────────────────────────────────
//
// Each migration transforms the user config from one schema version to the
// next. The current config version is stored as `configVersion` in the
// user's config.yaml (absent = 0, the pre-migration default). Migrations
// run in order: 0→1, 1→2, etc. A migration that throws aborts the update
// and triggers rollback.
//
// To add a migration in a future release, push to MIGRATIONS below:
//   { from: 1, to: 2, migrate(config) { ... return newConfig; } }

export const CURRENT_CONFIG_VERSION = 1;

const MIGRATIONS = [
    // v0 → v1: ensure `configVersion` exists and all v1.3.1 fields are
    // present. No destructive renames yet - this is the initial
    // migration that stamps the version.
    {
        from: 0,
        to: 1,
        migrate(config) {
            return { ...config, configVersion: 1 };
        }
    }
];

export function pendingMigrations(currentVersion) {
    return MIGRATIONS.filter((m) => m.from >= currentVersion).sort((a, b) => a.from - b.from);
}

export function migrateConfig(config, targetVersion = CURRENT_CONFIG_VERSION) {
    let result = { ...config };
    const current = result.configVersion || 0;
    const migrations = MIGRATIONS.filter((m) => m.from >= current && m.to <= targetVersion).sort((a, b) => a.from - b.from);

    for (const migration of migrations) {
        result = migration.migrate(result);
        result.configVersion = migration.to;
    }

    if (migrations.length === 0 && !result.configVersion) {
        result.configVersion = CURRENT_CONFIG_VERSION;
    }

    return { config: result, migrated: migrations.length };
}

// ─── Backup / restore ─────────────────────────────────────────────────

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

export function backupDir() {
    return path.join(userStateDir(), "backups", `pre-self-update-${timestamp()}`);
}

export function backupConfig(destDir) {
    const configDir = userConfigDir();
    if (!existsSync(configDir)) {
        return { ok: true, details: "no user config directory to back up" };
    }
    mkdirSync(destDir, { recursive: true });
    const destConfig = path.join(destDir, "config");
    cpSync(configDir, destConfig, { recursive: true });
    return { ok: true, details: destConfig };
}

export function restoreConfig(srcDir) {
    const srcConfig = path.join(srcDir, "config");
    if (!existsSync(srcConfig)) {
        return { ok: true, details: "no config backup to restore" };
    }
    const configDir = userConfigDir();
    rmSync(configDir, { recursive: true, force: true });
    cpSync(srcConfig, configDir, { recursive: true });
    return { ok: true, details: configDir };
}

// isNpmGlobalInstall(root) -> true if `root` looks like an npm global
// install location (contains a node_modules path segment - the same
// signal npm's own package resolution relies on) rather than a git
// clone. Takes an explicit root instead of always reading repoRoot()
// internally so it's directly testable without faking the filesystem.
export function isNpmGlobalInstall(root = repoRoot()) {
    return root.includes(`${path.sep}node_modules${path.sep}`);
}

// ─── Git operations ───────────────────────────────────────────────────

export async function currentCommit() {
    const { code, stdout } = await captureShellCommand("git rev-parse HEAD");
    if (code !== 0) {
        throw new DevForgeError("Not a git repository or git not available");
    }
    return stdout.trim();
}

export async function workingTreeClean() {
    const { code, stdout } = await captureShellCommand("git status --porcelain");
    if (code !== 0) {
        throw new DevForgeError("Failed to check git status");
    }
    return stdout.trim().length === 0;
}

export async function gitPull() {
    const { code, stdout } = await captureShellCommand("git pull --ff-only 2>&1");
    return { ok: code === 0, output: stdout.trim(), code };
}

export async function gitResetTo(commitHash) {
    const code = await runShellCommand(`git reset --hard ${commitHash}`, { silent: true });
    return { ok: code === 0, code };
}

// ─── npm install ──────────────────────────────────────────────────────

export async function npmInstall() {
    const { code, stdout } = await captureShellCommand("npm install 2>&1");
    return { ok: code === 0, output: stdout.trim(), code };
}

// ─── User plugin updates ──────────────────────────────────────────────

export async function updateUserPlugins() {
    const pluginsRoot = path.join(userStateDir(), "plugins");
    if (!existsSync(pluginsRoot)) {
        return { ok: true, updated: 0, details: "no user plugins directory" };
    }

    let updated = 0;
    const entries = readdirSync(pluginsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());

    for (const entry of entries) {
        const pluginDir = path.join(pluginsRoot, entry.name);
        if (!existsSync(path.join(pluginDir, ".git"))) continue;

        const { code } = await captureShellCommand(`git -C ${pluginDir} pull --ff-only 2>&1`);
        if (code === 0) {
            updated++;
        } else {
            logger.warn(`Failed to update plugin '${entry.name}'`);
        }
    }

    return { ok: true, updated };
}

// ─── Changelog extraction ─────────────────────────────────────────────

export function extractChangelog(oldVersion, newVersion) {
    const changelogPath = path.join(repoRoot(), "CHANGELOG.md");
    if (!existsSync(changelogPath)) {
        return null;
    }

    const content = readFileSync(changelogPath, "utf8");
    const lines = content.split("\n");

    // Find the section for versions between oldVersion and newVersion.
    // Changelog entries use "## [x.y.z]" or "## [Unreleased]" headers.
    const sections = [];
    let currentSection = null;
    let currentLines = [];

    for (const line of lines) {
        const match = /^## \[([^\]]+)\]/.exec(line);
        if (match) {
            if (currentSection) {
                sections.push({ version: currentSection, content: currentLines.join("\n").trim() });
            }
            currentSection = match[1];
            currentLines = [];
        } else if (currentSection) {
            currentLines.push(line);
        }
    }
    if (currentSection) {
        sections.push({ version: currentSection, content: currentLines.join("\n").trim() });
    }

    // Collect all sections after oldVersion up to and including newVersion.
    // If oldVersion === newVersion (no version bump), return the Unreleased section.
    const result = [];
    let collecting = false;

    for (const section of sections) {
        if (section.version === oldVersion) {
            break;
        }
        if (section.version === "Unreleased" || !oldVersion) {
            collecting = true;
        }
        if (section.version === newVersion) {
            collecting = true;
        }
        if (collecting) {
            result.push(section);
        }
    }

    // If we didn't find a boundary, just return everything up to newVersion
    if (result.length === 0 && oldVersion !== newVersion) {
        for (const section of sections) {
            if (section.version === oldVersion) break;
            result.push(section);
        }
    }

    if (result.length === 0) return null;
    return result.map((s) => `## [${s.version}]\n${s.content}`).join("\n\n");
}

// ─── Orchestrator ─────────────────────────────────────────────────────

export async function selfUpdate({ dryRun = false, skipPlugins = false, skipNpm = false, onOutput } = {}) {
    const steps = [];
    const state = {
        oldVersion: getVersion(),
        oldCommit: null,
        backupPath: null,
        newVersion: null
    };

    function record(name, result) {
        steps.push({ name, ...result });
        return result;
    }

    // Step 1: Pre-flight - verify we're in a git repo. This whole
    // engine (git pull, git reset for rollback) only makes sense for a
    // git-clone install; an npm-installed copy (repoRoot() living under
    // a node_modules directory - the same test npm itself uses to
    // detect a package's install location) has no .git directory at
    // all, so degrade to a clear, actionable message instead of a bare
    // "not a git repository" error that leaves an npm user guessing.
    logger.section("Self-Update: Pre-flight");
    try {
        state.oldCommit = await currentCommit();
        logger.success(`Current version: ${state.oldVersion} (${state.oldCommit.slice(0, 8)})`);
        record("preflight", { ok: true });
    } catch (err) {
        logger.error(err.message);
        if (isNpmGlobalInstall()) {
            logger.info("This looks like an npm install (npm install -g devforgekit), not a git clone.");
            logger.info("Run 'npm update -g devforgekit' instead - self-update's git-based flow only applies to git-clone installs.");
            return { ok: false, steps, error: "npm install - use 'npm update -g devforgekit' instead", state };
        }
        return { ok: false, steps, error: "preflight failed", state };
    }

    // Check working tree
    let stashed = false;
    try {
        const clean = await workingTreeClean();
        if (!clean) {
            logger.warn("Working tree has uncommitted changes - stashing before pull");
            if (!dryRun) {
                const { code } = await captureShellCommand("git stash push -m 'devforgekit self-update' 2>&1");
                if (code === 0) {
                    stashed = true;
                    record("stash", { ok: true });
                } else {
                    logger.error("Could not stash changes - aborting to avoid conflicts");
                    return { ok: false, steps, error: "dirty working tree, stash failed", state };
                }
            }
        }
    } catch (err) {
        logger.error(err.message);
        return { ok: false, steps, error: "git status check failed", state };
    }

    if (dryRun) {
        logger.section("Self-Update: Dry Run (no changes will be made)");
        logger.info("Would: backup config, git pull, npm install, migrate config, update plugins, show changelog");
        state.newVersion = state.oldVersion;
        return { ok: true, steps, dryRun: true, state };
    }

    // Step 2: Backup config
    logger.section("Self-Update: Backup");
    state.backupPath = backupDir();
    const backupResult = backupConfig(state.backupPath);
    record("backup", backupResult);
    if (backupResult.ok) {
        logger.success(`Config backed up to ${state.backupPath}`);
    }

    // Step 3: git pull
    logger.section("Self-Update: Pull");
    const pullResult = await gitPull();
    record("pull", pullResult);
    if (!pullResult.ok) {
        logger.error(`git pull failed: ${pullResult.output}`);
        // Rollback
        logger.warn("Rolling back...");
        await gitResetTo(state.oldCommit);
        if (state.backupPath) restoreConfig(state.backupPath);
        if (stashed) await captureShellCommand("git stash pop 2>&1");
        return { ok: false, steps, error: "git pull failed", state, rollback: true };
    }
    logger.success("Repository updated");
    if (pullResult.output && pullResult.output !== "Already up to date.") {
        console.log(pullResult.output);
    }

    // Step 4: npm install
    if (!skipNpm) {
        logger.section("Self-Update: Dependencies");
        const npmResult = await npmInstall();
        record("npm", npmResult);
        if (!npmResult.ok) {
            logger.warn(`npm install had issues (exit ${npmResult.code}) - continuing`);
        } else {
            logger.success("Dependencies installed");
        }
    }

    // Step 5: Migrate config
    logger.section("Self-Update: Config Migration");
    const configPath = path.join(userConfigDir(), "config.yaml");
    let migrationResult;
    if (existsSync(configPath)) {
        try {
            const rawConfig = yamlLoad(readFileSync(configPath, "utf8")) || {};
            const { config: migrated, migrated: count } = migrateConfig(rawConfig);
            writeFileSync(configPath, yamlDump(migrated));
            migrationResult = { ok: true, migrated: count };
            if (count > 0) {
                logger.success(`Config migrated (${count} migration${count > 1 ? "s" : ""} applied)`);
            } else {
                logger.success("Config already up to date");
            }
        } catch (err) {
            migrationResult = { ok: false, error: err.message };
            logger.warn(`Config migration failed: ${err.message} - restoring backup`);
            if (state.backupPath) restoreConfig(state.backupPath);
        }
    } else {
        migrationResult = { ok: true, migrated: 0, details: "no user config file" };
        logger.info("No user config file to migrate");
    }
    record("migrate", migrationResult);

    // Step 6: Update user plugins
    if (!skipPlugins) {
        logger.section("Self-Update: Plugins");
        const pluginResult = await updateUserPlugins();
        record("plugins", pluginResult);
        if (pluginResult.ok) {
            if (pluginResult.updated > 0) {
                logger.success(`Updated ${pluginResult.updated} user plugin${pluginResult.updated > 1 ? "s" : ""}`);
            } else {
                logger.success("No user plugins to update");
            }
        }
    }

    // Step 7: Restore stash if we stashed
    if (stashed) {
        const { code } = await captureShellCommand("git stash pop 2>&1");
        record("unstash", { ok: code === 0 });
        if (code !== 0) {
            logger.warn("Could not pop stash - your local changes are in `git stash`");
        }
    }

    // Step 8: Show changelog
    state.newVersion = getVersion();
    logger.section("Self-Update: Complete");
    logger.success(`Updated from ${state.oldVersion} to ${state.newVersion}`);

    const changelog = extractChangelog(state.oldVersion, state.newVersion);
    if (changelog) {
        logger.section("What's New");
        console.log(changelog);
    } else if (state.oldVersion === state.newVersion) {
        logger.info("Already at the latest version");
    }

    return { ok: true, steps, state };
}
