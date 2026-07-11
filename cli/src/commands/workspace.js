// The Workspace Manager command surface (v1.2.4, see
// docs/WorkspaceManager.md). Every subcommand here is a thin wrapper -
// all real logic lives in core/workspace/*.js (store/switcher/health/
// snapshot/bundle/env/git/ssh/docker/kubernetes/cloud/shellIntegration),
// exactly the same "commands depend on core, core never depends on
// commands" split the rest of the CLI already follows (see
// docs/PlatformArchitecture.md section 13).
import path from "node:path";
import {
    createWorkspace, getWorkspace, saveWorkspace, listWorkspaces, deleteWorkspace,
    renameWorkspace, cloneWorkspace, getActiveWorkspaceName, searchWorkspaces
} from "../core/workspace/store.js";
import { switchToWorkspace, deactivateWorkspace, rollbackToSnapshot } from "../core/workspace/switcher.js";
import { verifyWorkspace } from "../core/workspace/health.js";
import { exportWorkspaceBundle, importWorkspaceBundle, repairWorkspace } from "../core/workspace/bundle.js";
import {
    createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot,
    exportSnapshot, compareSnapshots, compareWithCurrent
} from "../core/workspace/snapshot.js";
import {
    setSecret, setVariable, removeSecret, removeVariable,
    redactedEnvView, importEnvFile, exportEnvFile
} from "../core/workspace/env.js";
import { captureGitIdentity } from "../core/workspace/git.js";
import { PROVIDER_DEFAULT_HOSTS } from "../core/workspace/ssh.js";
import { captureDockerContext } from "../core/workspace/docker.js";
import { captureKubeContext } from "../core/workspace/kubernetes.js";
import { installShellHook, uninstallShellHook, isShellHookInstalled, shellInitScript } from "../core/workspace/shellIntegration.js";
import { getWorkspaceMetadata, formatMetadataSummary } from "../core/workspace/metadata.js";
import { verifyWorkspaceStructured, previewSwitch, formatSwitchPreview, diffWorkspaces, formatWorkspaceDiff, previewBundleImport, formatBundlePreview, computeWorkspaceHealth } from "../core/workspace/verification.js";
import { benchmarkWorkspace, formatBenchmarkResult } from "../core/workspace/benchmark.js";
import { getPlatform } from "../core/platform/index.js";
import { getProfile, getRecipe, getCollection, expandProfile, expandRecipe } from "../core/registry.js";
import { scanCompatibility } from "../core/compatibility/engine.js";
import { planRepair, executeRepairPlan } from "../core/compatibility/repair.js";
import { text, confirm } from "../lib/prompts.js";
import { table, section, healthBar } from "../lib/ui.js";
import { logger } from "../core/logger.js";
import { withErrorHandling, usageError } from "../core/errors.js";
import chalk from "chalk";

// resolveWorkspaceComponents(doc) -> deduplicated string[] of every
// component a workspace resolves to (its ad hoc `components` plus whatever
// its `profile`/`recipes`/`collections` expand to). A standalone re-
// derivation of core/workspace/health.js's private helper of the same
// name - that one is shaped around health's FAIL-on-dangling-reference
// semantics and isn't exported (see commands/compatibility.js for the
// identical reasoning at that other call site).
function resolveWorkspaceComponents(doc) {
    const names = new Set(doc.components || []);
    if (doc.profile) {
        try { for (const n of expandProfile(getProfile(doc.profile))) names.add(n); } catch { /* reported by workspace verify */ }
    }
    for (const recipeName of doc.recipes || []) {
        try { for (const n of expandRecipe(getRecipe(recipeName))) names.add(n); } catch { /* reported by workspace verify */ }
    }
    for (const collectionName of doc.collections || []) {
        try { for (const n of getCollection(collectionName).components) names.add(n); } catch { /* reported by workspace verify */ }
    }
    return [...names];
}

function requireName(name, promptMessage) {
    return name ? Promise.resolve(name) : text(promptMessage);
}

// resolveTargetName(name) -> `name`, or the active workspace's name if
// omitted. Shared by every subcommand that operates on "a workspace, or
// the active one by default" (verify/env/snapshot/ssh all take this
// shape) so the fallback logic and its error message are defined once.
function resolveTargetName(name) {
    if (name) return name;
    const active = getActiveWorkspaceName();
    if (!active) {
        throw usageError("No workspace name given and no workspace is currently active. Run 'devforgekit workspace switch <name>' first, or pass a name explicitly.");
    }
    return active;
}

function formatWorkspaceLine(doc, activeName) {
    const marker = doc.name === activeName ? "* " : "  ";
    const archived = doc.status === "archived" ? " [archived]" : "";
    return `${marker}${doc.name} - ${doc.description}${archived}`;
}

function printWorkspaceSummary(doc) {
    const active = getActiveWorkspaceName() === doc.name;
    logger.section(`${doc.name}${active ? " (active)" : ""}`);
    console.log(`  ${doc.description}`);
    console.log();
    console.log(`  Status:      ${doc.status}`);
    console.log(`  Owner:       ${doc.owner || "(none)"}`);
    console.log(`  Tags:        ${doc.tags.join(", ") || "(none)"}`);
    console.log(`  Created:     ${doc.createdAt}`);
    console.log(`  Modified:    ${doc.modifiedAt}`);
    console.log(`  Profile:     ${doc.profile || "(none)"}`);
    console.log(`  Collections: ${doc.collections.join(", ") || "(none)"}`);
    console.log(`  Recipes:     ${doc.recipes.join(", ") || "(none)"}`);
    console.log(`  Components:  ${doc.components.join(", ") || "(none)"}`);
    console.log(`  Plugins:     ${doc.plugins.join(", ") || "(none)"}`);
    console.log();
    console.log(`  Git:         name=${doc.git.name || "-"} email=${doc.git.email || "-"} branch=${doc.git.defaultBranch || "-"} lfs=${doc.git.lfs}`);
    console.log(`  SSH:         ${doc.ssh.identities.length} identit${doc.ssh.identities.length === 1 ? "y" : "ies"}`);
    console.log(`  Env:         ${Object.keys(doc.env.variables).length} variable(s), ${doc.env.secretKeys.length} secret(s)`);
    console.log(`  Docker:      context=${doc.docker.context || "-"}`);
    console.log(`  Kubernetes:  context=${doc.kubernetes.context || "-"} namespace=${doc.kubernetes.namespace || "-"}`);
    console.log(`  AI:          provider=${doc.ai.provider} model=${doc.ai.model || "-"}`);
    console.log(`  Editor:      ${doc.editor.app}`);
    if (doc.projectHistory.length > 0) {
        console.log();
        console.log(`  Project history (${doc.projectHistory.length}):`);
        for (const p of doc.projectHistory.slice(-5)) {
            console.log(`    ${p.createdAt}  ${p.stack.padEnd(12)}  ${p.name}  (${p.dir})`);
        }
    }
}

function printHealthResult(result) {
    for (const r of result.results) {
        if (r.status === "PASS") logger.success(r.description);
        else if (r.status === "WARNING") logger.warn(r.description);
        else logger.error(r.description);
    }
    console.log(`\n${healthBar(result.score)}`);
    logger.info(`${result.verdict} (${result.pass} pass, ${result.warn} warn, ${result.fail} fail)`);
}

// printSubsystemResults(subsystems) - each subsystem's apply*() has a
// genuinely different result shape (see switcher.js), so this formats
// each by name explicitly rather than guessing generically from its
// shape (an earlier generic version mistakenly printed
// "[ssh] applied=undefined" - ssh's result has no `applied` field at
// all, it has `identities`/`knownHosts`).
function printSubsystemResults(subsystems) {
    logger.section("Applied");
    for (const r of subsystems.git) {
        console.log(`  [git] ${r.key} ${r.action}: ${r.ok ? "ok" : `failed${r.reason ? ` (${r.reason})` : ""}`}`);
    }
    console.log(`  [ssh] ${subsystems.ssh.identities} identity block(s) written to ~/.ssh/config`);
    for (const kh of subsystems.ssh.knownHosts) {
        console.log(`  [ssh] known_hosts ${kh.host}: ${kh.status}${kh.reason ? ` (${kh.reason})` : ""}`);
    }
    console.log(`  [docker] ${subsystems.docker.applied ? "context applied" : `not applied (${subsystems.docker.reason})`}`);
    console.log(`  [kubernetes] ${subsystems.kubernetes.applied ? "context applied" : `not applied (${subsystems.kubernetes.reason})`}`);
    for (const c of subsystems.cloud) {
        console.log(`  [cloud:${c.provider}] ${c.applied ? "applied" : `not applied (${c.reason})`}`);
    }
    console.log(`  [shell] wrote ${subsystems.shell.file}`);
    console.log(`  [env] wrote ${subsystems.env.file}`);
}

export function registerWorkspaceCommand(program) {
    const workspace = program
        .command("workspace")
        .description("Manage isolated development environments (git/ssh/env/docker/k8s/cloud/shell identity, switched with one command)")
        .addHelpText("after", `
Examples:
  $ devforgekit workspace create acme         Create a new workspace
  $ devforgekit workspace switch acme         Apply its git/ssh/env/docker/cloud identity live
  $ devforgekit workspace health              Quick per-subsystem health score
  $ devforgekit workspace verify --structured Full PASS/WARNING/FAIL sweep, grouped by subsystem
  $ devforgekit workspace snapshot create acme  Point-in-time backup before risky changes

Learn more: docs/WorkspaceManager.md`);

    // ---------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------

    workspace
        .command("create [name]")
        .description("Create a new workspace")
        .option("--description <text>", "short description")
        .option("--owner <text>", "owner/free-text identity for this workspace")
        .option("--from-current", "seed git identity (and docker/kubernetes context references) from what's currently configured on this machine")
        .option("--switch", "switch to the new workspace immediately after creating it")
        .action(withErrorHandling(async function (nameArg) {
            const opts = this.opts();
            const name = await requireName(nameArg, "Workspace name (lowercase, hyphens only)?");
            if (!name) {
                logger.info("Cancelled - no name given.");
                return;
            }

            let doc = createWorkspace({ name, description: opts.description, owner: opts.owner });

            if (opts.fromCurrent) {
                const [git, dockerContext, kubeContext] = await Promise.all([
                    captureGitIdentity(), captureDockerContext(), captureKubeContext()
                ]);
                doc = { ...doc, git, docker: { ...doc.docker, context: dockerContext }, kubernetes: { ...doc.kubernetes, context: kubeContext } };
                saveWorkspace(doc);
                logger.info("Seeded from the current machine's live git identity and docker/kubernetes contexts.");
            }

            logger.success(`Created workspace '${name}'.`);
            if (opts.switch) {
                const { subsystems } = await switchToWorkspace(name);
                printSubsystemResults(subsystems);
            } else {
                logger.info(`Run 'devforgekit workspace switch ${name}' to activate it.`);
            }
        }));

    workspace
        .command("list")
        .description("List every workspace (archived ones hidden unless --all)")
        .option("--all", "include archived workspaces")
        .action(withErrorHandling(function () {
            const opts = this.opts();
            const entries = listWorkspaces();
            if (entries.length === 0) {
                logger.info("No workspaces yet. Run 'devforgekit workspace create <name>' to make one.");
                return;
            }
            const activeName = getActiveWorkspaceName();
            logger.section("Workspaces");
            for (const entry of entries) {
                if (!entry.valid) {
                    console.log(`  ! ${entry.name} - INVALID (${entry.reason})`);
                    continue;
                }
                if (entry.doc.status === "archived" && !opts.all) continue;
                console.log(formatWorkspaceLine(entry.doc, activeName));
            }
        }));

    workspace
        .command("show [name]")
        .description("Show a workspace's full configuration (defaults to the active workspace)")
        .action(withErrorHandling((name) => {
            printWorkspaceSummary(getWorkspace(resolveTargetName(name)));
        }));

    workspace
        .command("metadata [name]")
        .description("Show rich structured metadata for a workspace (defaults to the active workspace)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(function (name) {
            const opts = this.opts();
            const target = resolveTargetName(name);
            const doc = getWorkspace(target);
            let snapshotCount = null;
            try { snapshotCount = listSnapshots(target).length; } catch { /* workspace may not have snapshots dir */ }
            const meta = getWorkspaceMetadata(doc, { activeName: getActiveWorkspaceName(), snapshotCount });
            if (opts.json) {
                const { ai: { apiKeyRef: _redacted, ...aiRest } = {}, ...rest } = meta;
                console.log(JSON.stringify({ ...rest, ai: aiRest }, null, 2));
                return;
            }
            for (const line of formatMetadataSummary(meta)) console.log(line);
        }));

    workspace
        .command("switch <name>")
        .description("Switch to a workspace: applies its git/ssh/docker/kubernetes/cloud identity and regenerates its shell export")
        .option("--preview", "show what would change without actually switching")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            if (opts.preview) {
                const preview = await previewSwitch(name);
                for (const line of formatSwitchPreview(preview)) console.log(line);
                return;
            }
            const { subsystems } = await switchToWorkspace(name);
            logger.success(`Switched to '${name}'.`);
            printSubsystemResults(subsystems);
            if (!isShellHookInstalled("zsh") && !isShellHookInstalled("bash")) {
                logger.warn("No shell-init hook installed yet - env vars/aliases/functions won't reach new shells until you run 'devforgekit workspace shell-init'.");
            }
        }));

    workspace
        .command("deactivate")
        .description("Clear the active workspace (git/ssh/docker/kubernetes/cloud state is left as-is - see docs/WorkspaceManager.md)")
        .action(withErrorHandling(() => {
            deactivateWorkspace();
            logger.success("No workspace is active.");
        }));

    workspace
        .command("delete <name>")
        .description("Delete a workspace and all its local data (snapshots, secrets)")
        .option("-f, --force", "allow deleting the active workspace, and skip the confirmation prompt")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            if (!opts.force && !(await confirm(`Delete workspace '${name}' and all its snapshots/secrets? This cannot be undone.`, false))) {
                logger.info("Cancelled.");
                return;
            }
            deleteWorkspace(name, { force: opts.force });
            logger.success(`Deleted '${name}'.`);
        }));

    workspace
        .command("rename <oldName> <newName>")
        .description("Rename a workspace")
        .action(withErrorHandling((oldName, newName) => {
            renameWorkspace(oldName, newName);
            logger.success(`Renamed '${oldName}' to '${newName}'.`);
        }));

    workspace
        .command("clone <sourceName> <newName>")
        .description("Clone a workspace's configuration (never its secrets or snapshot history) under a new name")
        .option("--description <text>", "description for the clone")
        .action(withErrorHandling(function (sourceName, newName) {
            const opts = this.opts();
            cloneWorkspace(sourceName, newName, { description: opts.description });
            logger.success(`Cloned '${sourceName}' to '${newName}'.`);
        }));

    workspace
        .command("search <query>")
        .description("Search workspaces by name, tag, owner, profile/recipe/collection/component, git identity, or cloud reference")
        .action(withErrorHandling((query) => {
            const results = searchWorkspaces(query);
            if (results.length === 0) {
                throw usageError(`No workspaces matched '${query}'.`);
            }
            const activeName = getActiveWorkspaceName();
            logger.section(`Results for '${query}'`);
            for (const doc of results) console.log(formatWorkspaceLine(doc, activeName));
        }));

    // ---------------------------------------------------------------
    // Health
    // ---------------------------------------------------------------

    workspace
        .command("verify [name]")
        .description("Run a PASS/WARNING/FAIL health sweep across every subsystem a workspace declares (defaults to the active workspace)")
        .option("--structured", "group results by subsystem with per-field details")
        .option("--json", "output as JSON (implies --structured)")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const target = resolveTargetName(name);
            if (opts.structured || opts.json) {
                const result = await verifyWorkspaceStructured(getWorkspace(target));
                if (opts.json) {
                    console.log(JSON.stringify(result, null, 2));
                    return;
                }
                const groups = result.subsystems.map((sub) => [
                    chalk.bold(sub.label),
                    table(
                        sub.checks.map((check) => ({
                            field: check.field,
                            value: check.value,
                            status: check.status === "PASS" ? chalk.green("✓") : check.status === "WARNING" ? chalk.yellow("⚠") : chalk.red("✗")
                        })),
                        [
                            { key: "field", label: "FIELD" },
                            { key: "value", label: "VALUE" },
                            { key: "status", label: "" }
                        ]
                    )
                ].join("\n"));
                console.log(section(`Verifying '${target}'`, [healthBar(result.score), "", ...groups]));
                logger.info(`${result.verdict} (${result.pass} pass, ${result.warn} warn, ${result.fail} fail)`);
                if (result.fail > 0) process.exitCode = 1;
                return;
            }
            logger.section(`Verifying '${target}'`);
            const result = await verifyWorkspace(getWorkspace(target));
            printHealthResult(result);
            if (result.fail > 0) process.exitCode = 1;
        }));

    workspace
        .command("repair <name>")
        .description("Drop dangling references (a deleted profile/recipe/component/plugin) from a workspace")
        .action(withErrorHandling((name) => {
            const { repairs } = repairWorkspace(name);
            if (repairs.length === 0) {
                logger.success(`'${name}' has no dangling references - nothing to repair.`);
                return;
            }
            logger.section("Repaired");
            for (const r of repairs) logger.warn(r);
        }));

    // ---------------------------------------------------------------
    // Export / import (portable bundles)
    // ---------------------------------------------------------------

    workspace
        .command("export <name> [outDir]")
        .description("Export a portable .tar.gz bundle of a workspace (secrets and snapshot history excluded)")
        .action(withErrorHandling(async (name, outDir) => {
            const { archivePath } = await exportWorkspaceBundle(name, path.resolve(outDir || process.cwd()));
            logger.success(`Exported to ${archivePath}`);
            logger.info("Secrets were not included - re-set them on the importing machine with 'devforgekit workspace env set --secret'.");
        }));

    workspace
        .command("import <archive>")
        .description("Import a workspace bundle")
        .option("--name <name>", "import under a different name than the bundle recorded")
        .option("--overwrite", "replace an existing workspace of the same name")
        .option("--preview", "show what would be imported without actually importing")
        .action(withErrorHandling(async function (archive) {
            const opts = this.opts();
            if (opts.preview) {
                const preview = await previewBundleImport(path.resolve(archive), { newName: opts.name });
                for (const line of formatBundlePreview(preview)) console.log(line);
                return;
            }
            const { workspace: doc, repairs } = await importWorkspaceBundle(path.resolve(archive), { newName: opts.name, overwrite: opts.overwrite });
            logger.success(`Imported '${doc.name}'.`);
            for (const r of repairs) logger.warn(r);
        }));

    workspace
        .command("diff <nameA> <nameB>")
        .description("Compare two workspaces across all subsystems")
        .option("--json", "output as JSON")
        .action(withErrorHandling(function (nameA, nameB) {
            const opts = this.opts();
            const diff = diffWorkspaces(nameA, nameB);
            if (opts.json) {
                console.log(JSON.stringify(diff, null, 2));
                return;
            }
            for (const line of formatWorkspaceDiff(diff)) console.log(line);
        }));

    workspace
        .command("health [name]")
        .description("Show a quick health score with per-subsystem breakdown (defaults to the active workspace)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(function (name) {
            const opts = this.opts();
            const target = resolveTargetName(name);
            const health = computeWorkspaceHealth(getWorkspace(target));
            if (opts.json) {
                console.log(JSON.stringify(health, null, 2));
                return;
            }
            console.log(section(`Workspace Health: '${target}'`, [
                healthBar(health.score),
                "",
                table(
                    health.breakdown.map((item) => ({
                        subsystem: item.subsystem,
                        status: item.status === "healthy" ? chalk.green("✓ healthy") : chalk.dim("○ unconfigured"),
                        detail: item.detail
                    })),
                    [
                        { key: "subsystem", label: "SUBSYSTEM" },
                        { key: "status", label: "STATUS" },
                        { key: "detail", label: "DETAIL", maxWidth: 40 }
                    ]
                )
            ]));
        }));

    // ---------------------------------------------------------------
    // Snapshots + rollback
    // ---------------------------------------------------------------

    const snapshot = workspace
        .command("snapshot")
        .description("Point-in-time snapshots of a workspace's configuration");

    snapshot
        .command("create <name>")
        .description("Create a snapshot")
        .option("-m, --message <text>", "description of this snapshot")
        .action(withErrorHandling(function (name) {
            const opts = this.opts();
            const meta = createSnapshot(name, { message: opts.message || "" });
            logger.success(`Snapshot ${meta.id} created.`);
        }));

    snapshot
        .command("list <name>")
        .description("List a workspace's snapshots, newest first")
        .action(withErrorHandling((name) => {
            const snapshots = listSnapshots(name);
            if (snapshots.length === 0) {
                logger.info(`No snapshots for '${name}' yet.`);
                return;
            }
            logger.section(`Snapshots for '${name}'`);
            for (const s of snapshots) console.log(`  ${s.id}  ${s.createdAt || "?"}  ${s.message || ""}`);
        }));

    snapshot
        .command("restore <name> <snapshotId>")
        .description("Reset a workspace's stored configuration to a snapshot (does not touch the live machine - see 'workspace rollback' for that)")
        .action(withErrorHandling((name, snapshotId) => {
            restoreSnapshot(name, snapshotId);
            logger.success(`Restored '${name}' to snapshot ${snapshotId}.`);
        }));

    snapshot
        .command("compare <name> <snapshotId> [otherSnapshotId]")
        .description("Compare two snapshots, or one snapshot against the current configuration")
        .action(withErrorHandling((name, snapshotId, otherSnapshotId) => {
            const diff = otherSnapshotId ? compareSnapshots(name, snapshotId, otherSnapshotId) : compareWithCurrent(name, snapshotId);
            logger.section(`Diff: ${snapshotId} -> ${otherSnapshotId || "(current)"}`);
            console.log(`  Added:   ${diff.added.join(", ") || "(none)"}`);
            console.log(`  Removed: ${diff.removed.join(", ") || "(none)"}`);
            console.log(`  Changed: ${diff.changed.join(", ") || "(none)"}`);
        }));

    snapshot
        .command("delete <name> <snapshotId>")
        .description("Delete a snapshot")
        .action(withErrorHandling((name, snapshotId) => {
            deleteSnapshot(name, snapshotId);
            logger.success(`Deleted snapshot ${snapshotId}.`);
        }));

    snapshot
        .command("export <name> <snapshotId> <destPath>")
        .description("Export a single snapshot's configuration to a JSON file")
        .action(withErrorHandling((name, snapshotId, destPath) => {
            exportSnapshot(name, snapshotId, path.resolve(destPath));
            logger.success(`Exported snapshot ${snapshotId} to ${destPath}.`);
        }));

    workspace
        .command("rollback <name> <snapshotId>")
        .description("Roll back to a snapshot: takes a safety snapshot of the current state first, then restores - and if this is the active workspace, re-applies it live")
        .action(withErrorHandling(async (name, snapshotId) => {
            const { applied } = await rollbackToSnapshot(name, snapshotId);
            logger.success(`Rolled back '${name}' to snapshot ${snapshotId}.`);
            logger.info(applied ? "This is the active workspace - live git/ssh/docker/kubernetes/cloud/shell state was re-applied." : "This workspace is not active - only its stored configuration was reverted.");
        }));

    // ---------------------------------------------------------------
    // Environment variables
    // ---------------------------------------------------------------

    const env = workspace
        .command("env")
        .description("Manage a workspace's environment variables (plain + AES-256-GCM-encrypted secrets)");

    env
        .command("list [name]")
        .description("List a workspace's variables (secret values shown as <encrypted>, defaults to the active workspace)")
        .action(withErrorHandling((name) => {
            const view = redactedEnvView(getWorkspace(resolveTargetName(name)));
            const entries = Object.entries(view);
            if (entries.length === 0) {
                logger.info("No environment variables set.");
                return;
            }
            for (const [key, value] of entries) console.log(`  ${key}=${value}`);
        }));

    env
        .command("set <name> <key> <value>")
        .description("Set a variable (plain by default; --secret encrypts it)")
        .option("--secret", "store as an encrypted secret instead of a plain variable")
        .action(withErrorHandling(function (name, key, value) {
            const opts = this.opts();
            const doc = getWorkspace(name);
            saveWorkspace(opts.secret ? setSecret(doc, key, value) : setVariable(doc, key, value));
            logger.success(`Set ${key}${opts.secret ? " (secret)" : ""} on '${name}'.`);
        }));

    env
        .command("unset <name> <key>")
        .description("Remove a variable or secret")
        .action(withErrorHandling((name, key) => {
            const doc = getWorkspace(name);
            const updated = (doc.env.secretKeys || []).includes(key) ? removeSecret(doc, key) : removeVariable(doc, key);
            saveWorkspace(updated);
            logger.success(`Removed ${key} from '${name}'.`);
        }));

    env
        .command("import <name> <file>")
        .description("Import a .env file's variables into a workspace")
        .option("--secret <keys>", "comma-separated key names to store as encrypted secrets instead of plain variables")
        .action(withErrorHandling(function (name, file) {
            const opts = this.opts();
            const secretKeys = opts.secret ? opts.secret.split(",").map((k) => k.trim()).filter(Boolean) : [];
            const doc = importEnvFile(getWorkspace(name), path.resolve(file), { secretKeys });
            saveWorkspace(doc);
            logger.success(`Imported variables from ${file} into '${name}'.`);
        }));

    env
        .command("export <name> <file>")
        .description("Export a workspace's variables to a .env file")
        .option("--include-secrets", "decrypt and include secret values (writes plaintext to disk)")
        .action(withErrorHandling(function (name, file) {
            const opts = this.opts();
            exportEnvFile(getWorkspace(name), path.resolve(file), { includeSecrets: opts.includeSecrets });
            logger.success(`Exported '${name}' variables to ${file}${opts.includeSecrets ? " (including decrypted secrets)" : ""}.`);
        }));

    // ---------------------------------------------------------------
    // SSH identities
    // ---------------------------------------------------------------

    const ssh = workspace
        .command("ssh")
        .description("Manage a workspace's SSH identities (~/.ssh/config Host blocks)");

    ssh
        .command("list <name>")
        .description("List a workspace's SSH identities")
        .action(withErrorHandling((name) => {
            const identities = getWorkspace(name).ssh.identities;
            if (identities.length === 0) {
                logger.info("No SSH identities declared.");
                return;
            }
            for (const i of identities) {
                console.log(`  ${i.hostAlias || i.host} -> ${i.host}${i.user ? ` (user=${i.user})` : ""}${i.identityFile ? ` key=${i.identityFile}` : ""}`);
            }
        }));

    ssh
        .command("add-identity <name>")
        .description("Add (or update) an SSH identity")
        .option("--host <host>", "hostname (e.g. github.com) - defaults from --provider if omitted")
        .option("--alias <alias>", "Host alias in ~/.ssh/config (defaults to --host)")
        .option("--user <user>", "SSH user (typically 'git')")
        .option("--identity-file <path>", "path to the private key (never copied - referenced in place)")
        .option("--port <port>", "SSH port", (v) => parseInt(v, 10))
        .option("--provider <provider>", "github|gitlab|bitbucket|custom")
        .action(withErrorHandling(function (name) {
            const options = this.opts();
            const provider = options.provider || "custom";
            const host = options.host || PROVIDER_DEFAULT_HOSTS[provider];
            if (!host) {
                throw usageError("--host is required (or pass --provider github|gitlab|bitbucket for a default).");
            }
            const doc = getWorkspace(name);
            const identity = { provider, host, hostAlias: options.alias || null, user: options.user || null, identityFile: options.identityFile || null, port: options.port || null };
            const identities = doc.ssh.identities.filter((i) => (i.hostAlias || i.host) !== (identity.hostAlias || identity.host));
            identities.push(identity);
            saveWorkspace({ ...doc, ssh: { ...doc.ssh, identities } });
            logger.success(`Added SSH identity '${identity.hostAlias || identity.host}' to '${name}'.`);
        }));

    ssh
        .command("remove-identity <name> <hostAlias>")
        .description("Remove an SSH identity by its host or alias")
        .action(withErrorHandling((name, hostAlias) => {
            const doc = getWorkspace(name);
            const identities = doc.ssh.identities.filter((i) => (i.hostAlias || i.host) !== hostAlias);
            if (identities.length === doc.ssh.identities.length) {
                throw usageError(`No SSH identity '${hostAlias}' on '${name}'.`);
            }
            saveWorkspace({ ...doc, ssh: { ...doc.ssh, identities } });
            logger.success(`Removed SSH identity '${hostAlias}' from '${name}'.`);
        }));

    // ---------------------------------------------------------------
    // Git identity capture
    // ---------------------------------------------------------------

    workspace
        .command("git-capture <name>")
        .description("Capture this machine's currently-configured git identity into a workspace")
        .action(withErrorHandling(async (name) => {
            const doc = getWorkspace(name);
            const git = await captureGitIdentity();
            saveWorkspace({ ...doc, git });
            logger.success(`Captured the live git identity into '${name}'.`);
        }));

    // ---------------------------------------------------------------
    // Shell integration
    // ---------------------------------------------------------------

    workspace
        .command("shell-init [shell]")
        .description("Install (or remove) the shell hook that sources the active workspace's exported env vars/aliases/functions on new shells")
        .option("--uninstall", "remove the hook instead of installing it")
        .option("--print", "print the hook line instead of installing/removing it")
        .action(withErrorHandling(function (shellArg) {
            const opts = this.opts();
            const shell = shellArg || getPlatform().defaultShell();
            if (opts.print) {
                console.log(shellInitScript());
                return;
            }
            if (opts.uninstall) {
                const removed = uninstallShellHook(shell);
                logger.success(removed ? `Removed the shell hook from your ${shell} rc file.` : "No shell hook was installed.");
                return;
            }
            const rcFile = installShellHook(shell);
            logger.success(`Installed the shell hook into ${rcFile}.`);
            logger.info("Restart your shell (or run 'exec zsh'/'exec bash') to apply.");
        }));

    // ---------------------------------------------------------------
    // Compatibility (v1.2.5 - see docs/CompatibilityEngine.md)
    // ---------------------------------------------------------------

    const compatibility = workspace
        .command("compatibility")
        .description("Scan/repair a workspace's resolved components for compatibility issues, and review its history");

    compatibility
        .command("scan [name]")
        .description("Scan a workspace's resolved components and record the result in its scanHistory (defaults to the active workspace)")
        .action(withErrorHandling(async (name) => {
            const target = resolveTargetName(name);
            const doc = getWorkspace(target);
            const componentNames = resolveWorkspaceComponents(doc);
            const result = await scanCompatibility(componentNames);

            printHealthResult({ results: result.issues.map((i) => ({ status: i.severity === "PASS" || i.severity === "RECOMMEND" ? "PASS" : i.severity === "WARNING" ? "WARNING" : "FAIL", description: `${i.tool}: ${i.message}` })), score: result.score, verdict: result.verdict, pass: result.pass, warn: result.warn, fail: result.critical + result.unsupported });

            const entry = { timestamp: new Date().toISOString(), score: result.score, verdict: result.verdict, pass: result.pass, recommend: result.recommend, warn: result.warn, critical: result.critical, unsupported: result.unsupported };
            const scanHistory = [...(doc.compatibility?.scanHistory || []), entry].slice(-50);
            saveWorkspace({ ...doc, compatibility: { ...doc.compatibility, scanHistory } });

            if (result.critical > 0 || result.unsupported > 0) process.exitCode = 1;
        }));

    compatibility
        .command("history [name]")
        .description("Show a workspace's compatibility scan/repair history (defaults to the active workspace)")
        .action(withErrorHandling((name) => {
            const doc = getWorkspace(resolveTargetName(name));
            const scanHistory = doc.compatibility?.scanHistory || [];
            const repairHistory = doc.compatibility?.repairHistory || [];

            logger.section(`Scan history for '${doc.name}' (${scanHistory.length})`);
            if (scanHistory.length === 0) logger.info("No scans recorded yet - run 'devforgekit workspace compatibility scan'.");
            for (const entry of scanHistory) console.log(`  ${entry.timestamp}  ${entry.score}%  ${entry.verdict}`);

            logger.section(`Repair history for '${doc.name}' (${repairHistory.length})`);
            if (repairHistory.length === 0) logger.info("No repairs recorded yet - run 'devforgekit workspace compatibility repair'.");
            for (const entry of repairHistory) console.log(`  ${entry.timestamp}  ${entry.succeeded}/${entry.actionCount} action(s) succeeded`);
        }));

    compatibility
        .command("repair [name]")
        .description("Repair a workspace's resolved components (install missing requirements, run recommended upgrades) and record the result in its repairHistory")
        .option("--dry-run", "only print the plan, don't execute it")
        .option("-y, --yes", "don't prompt before removing a conflicting package")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const target = resolveTargetName(name);
            const doc = getWorkspace(target);
            const componentNames = resolveWorkspaceComponents(doc);
            const scanResult = await scanCompatibility(componentNames);
            const actions = planRepair(scanResult);

            if (actions.length === 0) {
                logger.success("Nothing to repair.");
                return;
            }

            logger.section("Repair plan");
            for (const action of actions) console.log(`  [${action.type}] ${action.tool || action.name} - ${action.reason || action.message}`);
            if (opts.dryRun) {
                logger.info("--dry-run: no changes made.");
                return;
            }

            const results = await executeRepairPlan(actions, { assumeYes: Boolean(opts.yes) });
            const succeeded = results.filter((r) => r.ok).length;
            const failed = results.length - succeeded;
            for (const r of results) {
                if (r.skipped) logger.warn(`Skipped: ${r.action.tool || r.action.name}`);
                else if (r.ok) logger.success(`${r.action.type}: ${r.action.tool || r.action.name}`);
                else logger.error(`${r.action.type}: ${r.action.tool || r.action.name}${r.error ? ` (${r.error})` : ""}`);
            }

            const entry = { timestamp: new Date().toISOString(), actionCount: actions.length, succeeded, failed };
            const repairHistory = [...(doc.compatibility?.repairHistory || []), entry].slice(-50);
            saveWorkspace({ ...doc, compatibility: { ...doc.compatibility, repairHistory } });

            if (failed > 0) process.exitCode = 1;
        }));

    // ---------------------------------------------------------------
    // Benchmark
    // ---------------------------------------------------------------

    workspace
        .command("benchmark <name>")
        .description("Benchmark core workspace operations. Read-only by default (metadata, health, verify, diff) - pass --ops to include mutating ones (snapshot, switch, restore, bundleExport, bundleImport), which write files and/or change your live git/ssh/docker/kubernetes/cloud-CLI identity")
        .option("--runs <n>", "number of runs per operation (default: 1)", "1")
        .option("--ops <list>", "comma-separated list of operations to run (default: metadata,health,verify,diff - the read-only ones). Include snapshot/switch/restore/bundleExport/bundleImport explicitly to also benchmark those (mutating)")
        .option("--json", "output as JSON")
        .action(withErrorHandling(async function (name) {
            const opts = this.opts();
            const runs = parseInt(opts.runs, 10) || 1;
            const operations = opts.ops ? opts.ops.split(",").map((s) => s.trim()) : undefined;
            const result = await benchmarkWorkspace(name, { operations, runs });
            if (opts.json) {
                console.log(JSON.stringify(result, null, 2));
                return;
            }
            for (const line of formatBenchmarkResult(result)) console.log(line);
        }));
}
