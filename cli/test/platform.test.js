// Unit tests for the v2.0.7 OS Abstraction Layer (core/platform/). Uses
// setPlatformForTesting() to exercise MacOSPlatform/LinuxPlatform/
// WindowsPlatform deterministically regardless of which OS actually runs
// this suite, rather than mocking os.platform() globally.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    getPlatform,
    setPlatformForTesting,
    resetPlatformForTesting,
    MacOSPlatform,
    LinuxPlatform,
    WindowsPlatform,
    PlatformNotSupportedError
} from "../src/core/platform/index.js";
import { DevForgeError } from "../src/core/errors.js";

// A malicious package id crafted to break out of the unquoted shell
// string every installCommand()/upgradeCommand() interpolates step.id/
// name into (core/shell.js's runShellCommand always shells out). Real
// package-manager identifiers never contain spaces or shell
// metacharacters - assertSafePackageId (core/platform/errors.js) refuses
// anything that doesn't look like one, closing the injection class
// outright instead of trying to escape it for both POSIX shells and
// cmd.exe.
const INJECTION_PAYLOAD = `evil" ; touch /tmp/pwned ; echo "`;

test("getPlatform() returns a real adapter matching the running OS by default", () => {
    resetPlatformForTesting();
    const platform = getPlatform();
    assert.ok(["macos", "linux", "windows"].includes(platform.id));
});

test("getPlatform() returns the same cached instance across calls", () => {
    resetPlatformForTesting();
    assert.equal(getPlatform(), getPlatform());
});

test("setPlatformForTesting()/resetPlatformForTesting() swap the active adapter", () => {
    setPlatformForTesting(new LinuxPlatform());
    assert.equal(getPlatform().id, "linux");
    setPlatformForTesting(new WindowsPlatform());
    assert.equal(getPlatform().id, "windows");
    resetPlatformForTesting();
});

test("MacOSPlatform: identity, shell, bin dirs, package manager", () => {
    const platform = new MacOSPlatform();
    assert.equal(platform.id, "macos");
    assert.equal(platform.label, "macOS");
    assert.equal(platform.defaultShell(), "zsh");
    assert.equal(platform.packageManagerId(), "brew");
    assert.ok(platform.binSearchDirs().includes("/opt/homebrew/bin"));
    assert.ok(platform.binSearchDirs().includes("/usr/local/bin"));
    assert.ok(platform.packageManagerCacheDir().endsWith("Library/Caches/Homebrew"));
});

test("MacOSPlatform: shellConfigFile resolves zsh/bash/fish rc paths", () => {
    const platform = new MacOSPlatform();
    assert.ok(platform.shellConfigFile("zsh").endsWith(".zshrc"));
    assert.ok(platform.shellConfigFile("bash").endsWith(".bashrc"));
    assert.ok(platform.shellConfigFile("fish").endsWith("config.fish"));
    assert.ok(platform.shellConfigFile().endsWith(".zshrc"), "defaults to the platform's default shell");
});

test("MacOSPlatform: installCommand builds brew-formula/brew-cask/npm/pip/cargo/mise/shell commands", () => {
    const platform = new MacOSPlatform();
    assert.equal(platform.installCommand({ method: "brew-formula", id: "wget" }, "install"), "brew install wget");
    assert.equal(platform.installCommand({ method: "brew-formula", id: "wget" }, "uninstall"), "brew uninstall wget");
    assert.equal(platform.installCommand({ method: "brew-cask", id: "docker" }, "install"), "brew install --cask docker");
    assert.equal(platform.installCommand({ method: "brew-cask", id: "docker" }, "uninstall"), "brew uninstall --cask docker");
    assert.equal(
        platform.installCommand({ method: "brew-formula", id: "bun", tap: "oven-sh/bun" }, "install"),
        "brew tap oven-sh/bun && brew install bun"
    );
    assert.equal(platform.installCommand({ method: "npm", id: "pnpm" }, "install"), "npm install -g pnpm");
    assert.equal(platform.installCommand({ method: "npm", id: "pnpm" }, "uninstall"), "npm uninstall -g pnpm");
    assert.equal(platform.installCommand({ method: "pip", id: "black" }, "install"), "pip install black");
    assert.equal(platform.installCommand({ method: "cargo", id: "ripgrep" }, "install"), "cargo install ripgrep");
    assert.equal(platform.installCommand({ method: "mise", id: "node" }, "install"), "mise use -g node");
    assert.equal(platform.installCommand({ method: "shell", command: "echo hi" }, "install"), "echo hi");
});

test("go install method: appends @latest when the id has no version pin, and uninstall removes the built binary from GOPATH/bin", () => {
    const platform = new MacOSPlatform();
    assert.equal(
        platform.installCommand({ method: "go", id: "github.com/jesseduffield/lazygit" }, "install"),
        "go install github.com/jesseduffield/lazygit@latest"
    );
    assert.equal(
        platform.installCommand({ method: "go", id: "github.com/jesseduffield/lazygit@v0.44.1" }, "install"),
        "go install github.com/jesseduffield/lazygit@v0.44.1"
    );
    assert.equal(
        platform.installCommand({ method: "go", id: "github.com/jesseduffield/lazygit" }, "uninstall"),
        'rm -f "$(go env GOPATH 2>/dev/null || echo "$HOME/go")/bin/lazygit"'
    );
});

test("MacOSPlatform: installCommand throws PlatformNotSupportedError for an unknown method", () => {
    const platform = new MacOSPlatform();
    assert.throws(() => platform.installCommand({ method: "choco", id: "x" }, "install"), PlatformNotSupportedError);
});

test("upgradeCommand() builds `brew upgrade <name>` on macOS", () => {
    const platform = new MacOSPlatform();
    assert.equal(platform.upgradeCommand("wget"), "brew upgrade wget");
});

test("MacOSPlatform: installCommand/upgradeCommand refuse a package id/tap/name containing shell metacharacters", () => {
    const platform = new MacOSPlatform();
    assert.throws(() => platform.installCommand({ method: "brew-formula", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "brew-cask", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "brew-formula", id: "wget", tap: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "npm", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "go", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.upgradeCommand(INJECTION_PAYLOAD), DevForgeError);
    // Real package ids with legitimate special characters must still work.
    assert.equal(platform.installCommand({ method: "npm", id: "@angular/cli" }, "install"), "npm install -g @angular/cli");
    assert.equal(platform.installCommand({ method: "pip", id: "huggingface_hub[cli]" }, "install"), "pip install huggingface_hub[cli]");
});

test("LinuxPlatform: identity, default shell, package manager detection", () => {
    const platform = new LinuxPlatform();
    assert.equal(platform.id, "linux");
    assert.equal(platform.label, "Linux");
    assert.equal(platform.defaultShell(), "bash");
    // packageManagerId() returns the detected pm or null — not fabricated
    const pmId = platform.packageManagerId();
    assert.ok(pmId === null || ["apt", "dnf", "pacman"].includes(pmId));
});

test("LinuxPlatform: OS-agnostic install methods still work (npm/pip/cargo/mise/shell)", () => {
    const platform = new LinuxPlatform();
    assert.equal(platform.installCommand({ method: "npm", id: "pnpm" }, "install"), "npm install -g pnpm");
    assert.equal(platform.installCommand({ method: "shell", command: "echo hi" }, "install"), "echo hi");
});

test("LinuxPlatform: installCommand/upgradeCommand refuse an apt/dnf/pacman package id containing shell metacharacters", () => {
    const platform = new LinuxPlatform();
    assert.throws(() => platform.installCommand({ method: "apt", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "dnf", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "pacman", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.upgradeCommand(INJECTION_PAYLOAD), DevForgeError);
});

test("LinuxPlatform: apt/dnf/pacman install commands are built correctly", () => {
    const platform = new LinuxPlatform();
    assert.equal(
        platform.installCommand({ method: "apt", id: "wget" }, "install"),
        "sudo apt update && sudo apt install -y wget"
    );
    assert.equal(
        platform.installCommand({ method: "apt", id: "wget" }, "uninstall"),
        "sudo apt remove -y wget"
    );
    assert.equal(
        platform.installCommand({ method: "dnf", id: "git" }, "install"),
        "sudo dnf install -y git"
    );
    assert.equal(
        platform.installCommand({ method: "dnf", id: "git" }, "uninstall"),
        "sudo dnf remove -y git"
    );
    assert.equal(
        platform.installCommand({ method: "pacman", id: "ripgrep" }, "install"),
        "sudo pacman -S --noconfirm ripgrep"
    );
    assert.equal(
        platform.installCommand({ method: "pacman", id: "ripgrep" }, "uninstall"),
        "sudo pacman -Rns --noconfirm ripgrep"
    );
});

test("LinuxPlatform: brew-formula/brew-cask install steps throw PlatformNotSupportedError", () => {
    const platform = new LinuxPlatform();
    assert.throws(() => platform.installCommand({ method: "brew-formula", id: "wget" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "brew-cask", id: "docker" }, "install"), PlatformNotSupportedError);
});

test("LinuxPlatform: winget/choco/scoop install steps throw PlatformNotSupportedError", () => {
    const platform = new LinuxPlatform();
    assert.throws(() => platform.installCommand({ method: "winget", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "choco", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "scoop", id: "x" }, "install"), PlatformNotSupportedError);
});

test("WindowsPlatform: identity, default shell, package manager detection", () => {
    const platform = new WindowsPlatform();
    assert.equal(platform.id, "windows");
    assert.equal(platform.label, "Windows");
    assert.equal(platform.defaultShell(), "powershell");
    // packageManagerId() returns the detected pm or null — not fabricated
    const pmId = platform.packageManagerId();
    assert.ok(pmId === null || ["winget", "choco", "scoop"].includes(pmId));
});

test("WindowsPlatform: winget/choco/scoop install commands are built correctly", () => {
    const platform = new WindowsPlatform();
    assert.equal(
        platform.installCommand({ method: "winget", id: "Git.Git" }, "install"),
        "winget install --id Git.Git --accept-package-agreements --accept-source-agreements"
    );
    assert.equal(
        platform.installCommand({ method: "winget", id: "Git.Git" }, "uninstall"),
        "winget uninstall --id Git.Git --silent"
    );
    assert.equal(
        platform.installCommand({ method: "choco", id: "git" }, "install"),
        "choco install git -y"
    );
    assert.equal(
        platform.installCommand({ method: "choco", id: "git" }, "uninstall"),
        "choco uninstall git -y"
    );
    assert.equal(
        platform.installCommand({ method: "scoop", id: "ripgrep" }, "install"),
        "scoop install ripgrep"
    );
    assert.equal(
        platform.installCommand({ method: "scoop", id: "ripgrep" }, "uninstall"),
        "scoop uninstall ripgrep"
    );
});

test("WindowsPlatform: brew-formula/brew-cask/apt/dnf/pacman throw PlatformNotSupportedError", () => {
    const platform = new WindowsPlatform();
    assert.throws(() => platform.installCommand({ method: "brew-formula", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "apt", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "dnf", id: "x" }, "install"), PlatformNotSupportedError);
    assert.throws(() => platform.installCommand({ method: "pacman", id: "x" }, "install"), PlatformNotSupportedError);
});

test("WindowsPlatform: installCommand/upgradeCommand refuse a winget/choco/scoop package id containing shell metacharacters", () => {
    const platform = new WindowsPlatform();
    assert.throws(() => platform.installCommand({ method: "winget", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "choco", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.installCommand({ method: "scoop", id: INJECTION_PAYLOAD }, "install"), DevForgeError);
    assert.throws(() => platform.upgradeCommand(INJECTION_PAYLOAD), DevForgeError);
});

test("WindowsPlatform: shellConfigFile resolves a PowerShell profile path", () => {
    const platform = new WindowsPlatform();
    assert.ok(platform.shellConfigFile().includes("WindowsPowerShell"));
});

test("architecture() maps CPU arch consistently across platforms", () => {
    const linux = new LinuxPlatform();
    const windows = new WindowsPlatform();
    const macos = new MacOSPlatform();
    // Whatever this machine's real arch is, macOS reports it in the
    // intel/apple-silicon vocabulary while Linux/Windows report the
    // generic arm64/x64/arm one - never "unknown" for a known Node arch.
    for (const platform of [linux, windows, macos]) {
        assert.notEqual(platform.architecture(), "unknown");
    }
    assert.ok(["intel", "apple-silicon"].includes(macos.architecture()));
    assert.ok(["arm64", "x64", "arm"].includes(linux.architecture()));
});

test("base Platform class throws if instantiated and used directly (no id)", async () => {
    const { Platform } = await import("../src/core/platform/base.js");
    const platform = new Platform();
    assert.throws(() => platform.id, /must be implemented by a subclass/);
});

test("installer resolveInstallStep uses platformInstall on macOS", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new MacOSPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "shell", command: "echo fallback" },
            platformInstall: {
                macos: { method: "brew-formula", id: "test-pkg" },
                linux: { method: "apt", id: "test-pkg" },
                windows: { method: "winget", id: "Test.Pkg" },
            },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "brew-formula");
        assert.equal(step.id, "test-pkg");
    } finally {
        resetPlatformForTesting();
    }
});

test("installer resolveInstallStep uses platformInstall on Linux", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "shell", command: "echo fallback" },
            platformInstall: {
                macos: { method: "brew-formula", id: "test-pkg" },
                linux: { method: "apt", id: "test-pkg" },
                windows: { method: "winget", id: "Test.Pkg" },
            },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "apt");
        assert.equal(step.id, "test-pkg");
    } finally {
        resetPlatformForTesting();
    }
});

test("installer resolveInstallStep uses platformInstall on Windows", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new WindowsPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "shell", command: "echo fallback" },
            platformInstall: {
                macos: { method: "brew-formula", id: "test-pkg" },
                linux: { method: "apt", id: "test-pkg" },
                windows: { method: "winget", id: "Test.Pkg" },
            },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "winget");
        assert.equal(step.id, "Test.Pkg");
    } finally {
        resetPlatformForTesting();
    }
});

// LinuxPlatform's detection paths (apt/dnf/pacman binaries, /etc/os-release,
// /proc/version) are constructor-injectable specifically so these "degrades
// gracefully with nothing detected" tests are deterministic regardless of
// what the real host running the test suite happens to have - a real
// bug this same assumption caused: the previous, unparameterized version
// of these tests only ever passed on macOS (no apt/dnf/pacman/os-release
// there), and silently failed the first time cli.yml's `test` job actually
// ran on its real ubuntu-latest host (apt genuinely exists there, so
// "no package manager detected" was never really being tested at all).
const NO_LINUX_PM = { aptPath: "/nonexistent/apt", dnfPath: "/nonexistent/dnf", pacmanPath: "/nonexistent/pacman" };
const NO_OS_RELEASE = { osReleasePath: "/nonexistent/os-release", procVersionPath: "/nonexistent/proc-version" };

test("LinuxPlatform: packagePrefix()/outdatedPackages() degrade to null/[] with no package manager detected", async () => {
    const platform = new LinuxPlatform(NO_LINUX_PM);
    assert.equal(await platform.packagePrefix("wget"), null);
    assert.deepEqual(await platform.outdatedPackages(), []);
});

test("LinuxPlatform: upgradeCommand() throws PlatformNotSupportedError with no package manager detected", () => {
    const platform = new LinuxPlatform(NO_LINUX_PM);
    assert.throws(() => platform.upgradeCommand("wget"), PlatformNotSupportedError);
});

test("LinuxPlatform: osVersion()/packageManagerCacheDir()/wsl are honest (null/false) with no os-release/proc-version/package manager", async () => {
    const platform = new LinuxPlatform({ ...NO_LINUX_PM, ...NO_OS_RELEASE });
    assert.equal(await platform.osVersion(), null);
    assert.equal(platform.packageManagerCacheDir(), null);
    assert.equal(platform.wsl, false);
});

test("LinuxPlatform: packageManagerId()/osVersion()/wsl detect the real host when paths exist (proves the injection seam isn't just a no-op)", async () => {
    const workDir = mkdtempSync(path.join(tmpdir(), "devforgekit-linux-platform-test-"));
    try {
        const aptPath = path.join(workDir, "apt");
        writeFileSync(aptPath, "");
        const osReleasePath = path.join(workDir, "os-release");
        writeFileSync(osReleasePath, 'PRETTY_NAME="Test Linux 1.0"\n');
        const procVersionPath = path.join(workDir, "proc-version");
        writeFileSync(procVersionPath, "Linux version 6.6.0-microsoft-standard-WSL2\n");

        const platform = new LinuxPlatform({ aptPath, dnfPath: "/nonexistent/dnf", pacmanPath: "/nonexistent/pacman", osReleasePath, procVersionPath });
        assert.equal(platform.packageManagerId(), "apt");
        assert.equal(platform.packageManagerCacheDir(), "/var/cache/apt/archives");
        assert.equal(await platform.osVersion(), "Test Linux 1.0");
        assert.equal(platform.wsl, true);
    } finally {
        rmSync(workDir, { recursive: true, force: true });
    }
});

test("WindowsPlatform: packagePrefix()/outdatedPackages() degrade to null/[] rather than throwing with no package manager detected", async () => {
    const platform = new WindowsPlatform();
    assert.equal(await platform.packagePrefix("git"), null);
    assert.deepEqual(await platform.outdatedPackages(), []);
});

test("WindowsPlatform: upgradeCommand() throws PlatformNotSupportedError with no package manager detected", () => {
    const platform = new WindowsPlatform();
    assert.throws(() => platform.upgradeCommand("git"), PlatformNotSupportedError);
});

test("WindowsPlatform: osVersion()/packageManagerCacheDir() are honest (null) off a real Windows host", async () => {
    const platform = new WindowsPlatform();
    assert.equal(await platform.osVersion(), null);
    assert.equal(platform.packageManagerCacheDir(), null);
});

test("installer resolveInstallStep falls back to top-level install when no platformInstall match", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "test-pkg",
            install: { method: "npm", id: "test-pkg" },
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "npm");
    } finally {
        resetPlatformForTesting();
    }
});

// Registry Completion (v3.0): a Linux platformInstall entry can be an
// array of installSteps (one per package manager - apt/dnf/pacman) so a
// single manifest serves an apt user AND a dnf user correctly, instead
// of hardcoding one distro family. This dev machine's LinuxPlatform
// detects no real apt/dnf/pacman binary (it's a Mac), so
// packageManagerId() returns null and resolution falls back to the
// array's first entry - the one behavior actually verifiable without a
// real Linux host; picking the *matching* entry when one IS detected is
// exercised by pickPlatformEntry's own logic (entry.method === pmId),
// not re-derivable here without mocking detectPackageManager().
test("installer resolveInstallStep: an array platformInstall entry resolves to its first entry when no package manager is detected", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "multi-pm-pkg",
            install: { method: "brew-formula", id: "multi-pm-pkg" },
            platformInstall: {
                linux: [
                    { method: "apt", id: "multi-pm-pkg" },
                    { method: "dnf", id: "multi-pm-pkg" },
                    { method: "pacman", id: "multi-pm-pkg" }
                ]
            }
        };
        const step = resolveInstallStep(pkg);
        assert.equal(step.method, "apt");
    } finally {
        resetPlatformForTesting();
    }
});

test("installer resolveInstallStep: an explicit { unsupported, reason } platformInstall entry throws PlatformNotSupportedError with the real authored reason", async () => {
    const { resolveInstallStep } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "macos-only-pkg",
            install: { method: "brew-cask", id: "macos-only-pkg" },
            platformInstall: {
                linux: { unsupported: true, reason: "no Linux port exists as of 2026" }
            }
        };
        assert.throws(
            () => resolveInstallStep(pkg),
            (err) => err instanceof PlatformNotSupportedError && err.message.includes("no Linux port exists as of 2026")
        );
    } finally {
        resetPlatformForTesting();
    }
});

// Item 7 (Registry Completion v3.0 "Release Candidate Hardening" prep):
// repair()/update() run pkg.repair/pkg.update as opaque, pre-formatted
// shell strings (unlike install()/uninstall(), which validate their
// step's method against the live platform via commandForStep()) - so an
// explicit { unsupported, reason } platformInstall declaration needs its
// own check in both, verified here. Before this fix, a package
// unsupported on the current platform would have run its (macOS-shaped)
// repair/update string as a raw shell command and failed with a garbled
// "brew: command not found" instead of a clear, actionable error - and
// worse, for `update` specifically, would have actually attempted to
// run whatever shell command was there rather than refusing outright.
test("installer repair()/update(): an explicit { unsupported, reason } platformInstall declaration throws BEFORE ever running the shell command", async () => {
    const { repair, update } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "macos-only-pkg",
            install: { method: "brew-cask", id: "macos-only-pkg" },
            // A command that would loudly fail/misbehave if it were ever
            // actually run - proof the function returns before this point.
            repair: "false 'this should never execute'",
            update: "false 'this should never execute'",
            platformInstall: {
                linux: { unsupported: true, reason: "GUI-only macOS app, no Linux build exists" }
            }
        };
        await assert.rejects(
            () => repair(pkg),
            (err) => err instanceof PlatformNotSupportedError && err.message.includes("GUI-only macOS app, no Linux build exists")
        );
        await assert.rejects(
            () => update(pkg),
            (err) => err instanceof PlatformNotSupportedError && err.message.includes("GUI-only macOS app, no Linux build exists")
        );
    } finally {
        resetPlatformForTesting();
    }
});

test("installer repair()/update(): a package with no unsupported declaration for the current platform runs its command normally", async () => {
    const { repair, update } = await import("../src/core/installer.js");
    setPlatformForTesting(new LinuxPlatform());
    try {
        const pkg = {
            name: "cross-platform-pkg",
            install: { method: "shell", command: "true" },
            repair: "true",
            update: "true",
            platformInstall: {
                linux: { method: "apt", id: "cross-platform-pkg" }
            }
        };
        const repairCode = await repair(pkg);
        const updateCode = await update(pkg);
        assert.equal(repairCode, 0);
        assert.equal(updateCode, 0);
    } finally {
        resetPlatformForTesting();
    }
});

// Unsupported *package managers* (item 7's other half) - already
// covered by the "LinuxPlatform/WindowsPlatform: brew-formula/brew-cask/
// apt/dnf/pacman throw PlatformNotSupportedError" tests earlier in this
// file (installCommand() rejects a step whose method doesn't belong to
// the current platform family, regardless of which installer.js
// function dispatched it - install/uninstall both route through
// commandForStep() -> getPlatform().installCommand()).
