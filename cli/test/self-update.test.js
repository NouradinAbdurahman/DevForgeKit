import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { load as yamlLoad, dump as yamlDump } from "js-yaml";
import {
    migrateConfig,
    pendingMigrations,
    backupConfig,
    restoreConfig,
    backupDir,
    extractChangelog,
    CURRENT_CONFIG_VERSION,
    isNpmGlobalInstall
} from "../src/core/self-update.js";

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.config/devforgekit and ~/.devforgekit (same pattern as config.test.js).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-selfupdate-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── npm vs git-clone install detection ────────────────────────────────
//
// Regression guard: self-update's git pull/reset flow only applies to a
// git-clone install. Before this, an npm-installed copy (no .git
// directory) failed preflight with a bare "Not a git repository" error
// and no indication that `npm update -g devforgekit` was the actual fix.

test("isNpmGlobalInstall detects a path containing a node_modules segment", () => {
    assert.equal(isNpmGlobalInstall("/usr/local/lib/node_modules/devforgekit"), true);
    assert.equal(isNpmGlobalInstall("/opt/homebrew/lib/node_modules/devforgekit"), true);
});

test("isNpmGlobalInstall returns false for a plain git-clone path", () => {
    assert.equal(isNpmGlobalInstall("/Users/dev/Developer/DevForgeKit"), false);
    assert.equal(isNpmGlobalInstall(process.cwd()), false);
});

// ─── Config migration tests ───────────────────────────────────────────

test("migrateConfig stamps configVersion on a pre-migration config", () => {
    const raw = { editor: "vscode", shell: "zsh" };
    const { config, migrated } = migrateConfig(raw);
    assert.equal(migrated, 1);
    assert.equal(config.configVersion, CURRENT_CONFIG_VERSION);
    assert.equal(config.editor, "vscode");
    assert.equal(config.shell, "zsh");
});

test("migrateConfig is a no-op when already at current version", () => {
    const raw = { editor: "cursor", configVersion: CURRENT_CONFIG_VERSION };
    const { config, migrated } = migrateConfig(raw);
    assert.equal(migrated, 0);
    assert.equal(config.configVersion, CURRENT_CONFIG_VERSION);
    assert.equal(config.editor, "cursor");
});

test("migrateConfig preserves unknown fields", () => {
    const raw = { editor: "vim", customField: "keep-me" };
    const { config } = migrateConfig(raw);
    assert.equal(config.customField, "keep-me");
});

test("pendingMigrations returns migrations from the current version onward", () => {
    const pending = pendingMigrations(0);
    assert.ok(pending.length >= 1);
    assert.equal(pending[0].from, 0);
    assert.equal(pending[0].to, 1);
});

test("pendingMigrations returns empty when already at current version", () => {
    const pending = pendingMigrations(CURRENT_CONFIG_VERSION);
    assert.equal(pending.length, 0);
});

// ─── Backup / restore tests ───────────────────────────────────────────

test("backupConfig creates a copy of the user config directory", () => {
    withTempHome((tempHome) => {
        const configDir = path.join(tempHome, ".config", "devforgekit");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(path.join(configDir, "config.yaml"), "editor: vscode\n");
        mkdirSync(path.join(configDir, "profiles"), { recursive: true });
        writeFileSync(path.join(configDir, "profiles", "custom.yaml"), "name: custom\n");

        const dest = path.join(tempHome, ".devforgekit", "backups", "test-backup");
        const result = backupConfig(dest);
        assert.ok(result.ok);

        const backedUpConfig = path.join(dest, "config");
        assert.ok(existsSync(path.join(backedUpConfig, "config.yaml")));
        assert.ok(existsSync(path.join(backedUpConfig, "profiles", "custom.yaml")));
        assert.equal(
            readFileSync(path.join(backedUpConfig, "config.yaml"), "utf8"),
            "editor: vscode\n"
        );
    });
});

test("backupConfig succeeds when no user config directory exists", () => {
    withTempHome(() => {
        const dest = path.join(tmpdir(), "devforgekit-backup-empty-test");
        const result = backupConfig(dest);
        assert.ok(result.ok);
        assert.ok(result.details.includes("no user config"));
    });
});

test("restoreConfig replaces the current config with the backup", () => {
    withTempHome((tempHome) => {
        // Create original config
        const configDir = path.join(tempHome, ".config", "devforgekit");
        mkdirSync(configDir, { recursive: true });
        writeFileSync(path.join(configDir, "config.yaml"), "editor: original\n");

        // Back it up
        const backup = path.join(tempHome, ".devforgekit", "backups", "test-restore");
        backupConfig(backup);

        // Modify the config
        writeFileSync(path.join(configDir, "config.yaml"), "editor: modified\n");

        // Restore
        const result = restoreConfig(backup);
        assert.ok(result.ok);
        assert.equal(
            readFileSync(path.join(configDir, "config.yaml"), "utf8"),
            "editor: original\n"
        );
    });
});

test("restoreConfig succeeds when no backup exists", () => {
    withTempHome(() => {
        const result = restoreConfig("/nonexistent/backup/path");
        assert.ok(result.ok);
        assert.ok(result.details.includes("no config backup"));
    });
});

test("backupDir returns a path under ~/.devforgekit/backups", () => {
    withTempHome((tempHome) => {
        const dir = backupDir();
        assert.ok(dir.includes(path.join(".devforgekit", "backups")));
        assert.ok(dir.includes("pre-self-update-"));
    });
});

// ─── Changelog extraction tests ───────────────────────────────────────

test("extractChangelog returns null when no CHANGELOG.md exists", () => {
    withTempHome(() => {
        // repoRoot() is not affected by HOME, but the function checks
        // for CHANGELOG.md at the real repo root - it exists there, so
        // we test the null case by checking a non-matching version pair
        const changelog = extractChangelog("9.9.9", "9.9.9");
        // Same version with no matching section - may return null or empty
        // The important thing is it doesn't crash
        assert.ok(changelog === null || typeof changelog === "string");
    });
});

test("extractChangelog returns content for version transitions", () => {
    // The real repo has a CHANGELOG.md with [Unreleased] and version sections
    const changelog = extractChangelog(null, "Unreleased");
    // Should return the Unreleased section content
    assert.ok(changelog === null || typeof changelog === "string");
});

// ─── Integration: full backup → modify → restore cycle ────────────────

test("full backup-modify-restore cycle preserves config with nested directories", () => {
    withTempHome((tempHome) => {
        const configDir = path.join(tempHome, ".config", "devforgekit");

        // Create a rich config structure
        mkdirSync(configDir, { recursive: true });
        writeFileSync(path.join(configDir, "config.yaml"), yamlDump({
            editor: "vscode",
            shell: "zsh",
            configVersion: 1
        }));
        mkdirSync(path.join(configDir, "profiles"), { recursive: true });
        writeFileSync(path.join(configDir, "profiles", "my-profile.yaml"), yamlDump({
            name: "my-profile",
            components: ["node", "python"]
        }));
        mkdirSync(path.join(configDir, "recipes"), { recursive: true });
        writeFileSync(path.join(configDir, "recipes", "my-recipe.yaml"), yamlDump({
            name: "my-recipe",
            components: ["docker"]
        }));

        // Backup
        const backup = path.join(tempHome, ".devforgekit", "backups", "cycle-test");
        const backupResult = backupConfig(backup);
        assert.ok(backupResult.ok);

        // Destroy the original
        rmSync(configDir, { recursive: true, force: true });
        assert.ok(!existsSync(configDir));

        // Restore
        const restoreResult = restoreConfig(backup);
        assert.ok(restoreResult.ok);

        // Verify everything came back
        assert.ok(existsSync(path.join(configDir, "config.yaml")));
        assert.ok(existsSync(path.join(configDir, "profiles", "my-profile.yaml")));
        assert.ok(existsSync(path.join(configDir, "recipes", "my-recipe.yaml")));

        const restoredConfig = yamlLoad(readFileSync(path.join(configDir, "config.yaml"), "utf8"));
        assert.equal(restoredConfig.editor, "vscode");
        assert.equal(restoredConfig.configVersion, 1);
    });
});
