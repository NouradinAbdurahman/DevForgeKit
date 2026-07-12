// Builds the DevForgeKit Core CLI's commander Program (Layer 2 - see
// docs/PlatformArchitecture.md section 2). One module per command,
// registered here; adding a new top-level command means adding one file
// under src/commands/ and one register call below - it never contains
// command logic itself, mirroring the root `devforgekit` dispatcher's
// "pure dispatch table" convention one layer up.
import { Command } from "commander";
import { getVersion } from "./version.js";
import { setLogLevel } from "./core/logger.js";
import { registerPluginCommands, registerPluginEventHooks } from "./core/plugins.js";
import { registerEnvironmentEventHooks } from "./core/environment/index.js";

import { registerInstallCommand } from "./commands/install.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerNewCommand } from "./commands/new.js";
import { registerDashboardCommand } from "./commands/dashboard.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerBackupCommand } from "./commands/backup.js";
import { registerRestoreCommand } from "./commands/restore.js";
import { registerCheckCommand } from "./commands/check.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerInventoryCommand } from "./commands/inventory.js";
import { registerReportCommand } from "./commands/report.js";
import { registerServicesCommand } from "./commands/services.js";
import { registerCleanCommand } from "./commands/clean.js";
import { registerReleaseCommand } from "./commands/release.js";
import { registerRcValidateCommand } from "./commands/rc-validate.js";
import { registerPreferencesCommand } from "./commands/preferences.js";
import { registerProfileCommand } from "./commands/profile.js";
import { registerRecipeCommand } from "./commands/recipe.js";
import { registerConfigCommand } from "./commands/config.js";
import { registerComponentCommand } from "./commands/component.js";
import { registerPluginCommand } from "./commands/plugin.js";
import { registerSearchCommand } from "./commands/search.js";
import { registerCollectionCommand } from "./commands/collection.js";
import { registerRegistryCommand } from "./commands/registry.js";
import { registerStatsCommand } from "./commands/stats.js";
import { registerInfoCommand } from "./commands/info.js";
import { registerWorkspaceCommand } from "./commands/workspace.js";
import { registerCompatibilityCommand } from "./commands/compatibility.js";
import { registerAICommand } from "./commands/ai.js";
import { registerThemeCommand } from "./commands/theme.js";
import { registerSelfUpdateCommand } from "./commands/self-update.js";
import { registerSnapshotCommand } from "./commands/snapshot.js";
import { registerBenchmarkCommand } from "./commands/benchmark.js";
import { registerRepairCommand } from "./commands/repair.js";
import { registerPackageCommand } from "./commands/package.js";
import { registerGraphCommand } from "./commands/graph.js";
import { registerEnvironmentCommand } from "./commands/environment.js";
import { registerExplainCommand } from "./commands/explain.js";

export function createProgram() {
    const program = new Command();

    program
        .name("devforgekit")
        .description("DevForgeKit - a production-grade cross-platform development workstation lifecycle manager")
        .version(getVersion(), "-V, --version")
        .option("--verbose", "print extra diagnostic detail")
        .option("--debug", "print full stack traces on error")
        .hook("preAction", (thisCommand) => {
            const opts = thisCommand.opts();
            setLogLevel({ verbose: opts.verbose, debug: opts.debug });
            if (opts.debug) process.env.DEVFORGEKIT_DEBUG = "1";
        })
        .addHelpText("after", `
Examples:
  $ devforgekit new --list
  $ devforgekit new nextjs my-app
  $ devforgekit new flutter my-app --state riverpod --backend supabase
  $ devforgekit new express my-api --auth --prisma --swagger --docker
  $ devforgekit install --profile flutter
  $ devforgekit doctor --fix
  $ devforgekit component install
  $ devforgekit component list --category devops
  $ devforgekit component list --status --installed
  $ devforgekit component info flutter
  $ devforgekit component doctor flutter
  $ devforgekit component reinstall flutter
  $ devforgekit search postgres --category databases
  $ devforgekit collection install backend
  $ devforgekit profile install ai
  $ devforgekit profile create
  $ devforgekit recipe list
  $ devforgekit recipe install ai-engineer
  $ devforgekit recipe create
  $ devforgekit registry generate
  $ devforgekit registry stats
  $ devforgekit stats
  $ devforgekit info flutter
  $ devforgekit plugin list
  $ devforgekit plugin create my-plugin
  $ devforgekit plugin test my-plugin
  $ devforgekit plugin build my-plugin && devforgekit plugin package my-plugin
  $ devforgekit config set editor cursor
  $ devforgekit profile list
  $ devforgekit workspace create acme-backend --from-current --switch
  $ devforgekit workspace switch acme-backend
  $ devforgekit workspace verify
  $ devforgekit workspace snapshot create acme-backend -m "before upgrading node"
  $ devforgekit workspace rollback acme-backend <snapshotId>
  $ devforgekit workspace export acme-backend ./backups
  $ devforgekit compatibility scan
  $ devforgekit compatibility explain flutter
  $ devforgekit compatibility repair --dry-run
  $ devforgekit compatibility graph
  $ devforgekit compatibility export ./compatibility-report.md
  $ devforgekit ai providers
  $ devforgekit ai doctor
  $ devforgekit ai chat
  $ devforgekit ai generate "A REST API with JWT using FastAPI and PostgreSQL"
  $ devforgekit theme list
  $ devforgekit theme use nord
  $ devforgekit theme preview dracula
  $ devforgekit theme export -o my-theme.yaml
  $ devforgekit self-update
  $ devforgekit snapshot create
  $ devforgekit snapshot restore machine.dfk
  $ devforgekit snapshot list
  $ devforgekit snapshot inspect machine.dfk
  $ devforgekit snapshot verify machine.dfk
  $ devforgekit snapshot diff old.dfk new.dfk
  $ devforgekit benchmark quick
  $ devforgekit benchmark full
  $ devforgekit benchmark history
  $ devforgekit benchmark compare
  $ devforgekit repair scan
  $ devforgekit repair run
  $ devforgekit repair history
  $ devforgekit package analyze
  $ devforgekit package info flutter
  $ devforgekit package tree flutter
  $ devforgekit package orphan
  $ devforgekit package duplicates
  $ devforgekit graph open
  $ devforgekit graph impact flutter
  $ devforgekit graph path node docker
  $ devforgekit graph stats
  $ devforgekit env doctor
  $ devforgekit env list
  $ devforgekit env regenerate
  $ devforgekit env graph java
  $ devforgekit env diff
  $ devforgekit env watch
  $ devforgekit explain flutter
`);

    registerInstallCommand(program);
    registerUninstallCommand(program);
    registerNewCommand(program);
    registerDashboardCommand(program);
    registerUpdateCommand(program);
    registerBackupCommand(program);
    registerRestoreCommand(program);
    registerCheckCommand(program);
    registerDoctorCommand(program);
    registerValidateCommand(program);
    registerInventoryCommand(program);
    registerReportCommand(program);
    registerServicesCommand(program);
    registerCleanCommand(program);
    registerReleaseCommand(program);
    registerRcValidateCommand(program);
    registerPreferencesCommand(program);
    registerProfileCommand(program);
    registerRecipeCommand(program);
    registerConfigCommand(program);
    registerComponentCommand(program);
    registerPluginCommand(program);
    registerSearchCommand(program);
    registerCollectionCommand(program);
    registerRegistryCommand(program);
    registerStatsCommand(program);
    registerInfoCommand(program);
    registerWorkspaceCommand(program);
    registerCompatibilityCommand(program);
    registerAICommand(program);
    registerThemeCommand(program);
    registerSelfUpdateCommand(program);
    registerSnapshotCommand(program);
    registerBenchmarkCommand(program);
    registerRepairCommand(program);
    registerPackageCommand(program);
    registerGraphCommand(program);
    registerEnvironmentCommand(program);
    registerExplainCommand(program);

    // Layer 3 extension point: any plugins/*/plugin.yml declaring a
    // command hook gets registered as a live top-level command here, on
    // top of the built-in commands above; event hooks subscribe to the
    // shared pluginEvents bus (core/events.js) the same way.
    registerPluginCommands(program);
    registerPluginEventHooks();
    registerEnvironmentEventHooks();

    return program;
}
