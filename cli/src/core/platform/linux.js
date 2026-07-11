// Linux platform adapter (v2.2.3 Cross-Platform Implementation).
// Supports apt (Debian/Ubuntu), dnf (Fedora/RHEL), and pacman (Arch).
// Detects which package manager is available at runtime via existsSync
// on the binary path, with a precedence order of apt > dnf > pacman
// (matching the distro family most likely to have the others also
// installed, e.g. Ubuntu WSL with pacman available). WSL is detected
// via /proc/version containing "microsoft".
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { homeDir } from "../paths.js";
import { captureShellCommand } from "../shell.js";
import { Platform } from "./base.js";
import { PlatformNotSupportedError, assertSafePackageId } from "./errors.js";

const APT_PATH = "/usr/bin/apt";
const DNF_PATH = "/usr/bin/dnf";
const PACMAN_PATH = "/usr/bin/pacman";
const OS_RELEASE_PATH = "/etc/os-release";
const PROC_VERSION_PATH = "/proc/version";

function detectPackageManager({ aptPath = APT_PATH, dnfPath = DNF_PATH, pacmanPath = PACMAN_PATH } = {}) {
    if (existsSync(aptPath)) return "apt";
    if (existsSync(dnfPath)) return "dnf";
    if (existsSync(pacmanPath)) return "pacman";
    return null;
}

export class LinuxPlatform extends Platform {
    // Every detection path is injectable (aptPath/dnfPath/pacmanPath/
    // osReleasePath/procVersionPath), matching the fetchImpl-style DI
    // convention already used for AI provider clients and the Keychain
    // credential backend - lets cli/test/platform.test.js deterministically
    // exercise "no package manager detected"/"no /etc/os-release" without
    // depending on whether the real host running the test happens to be a
    // real Linux machine that does have apt/os-release (the previous,
    // unparameterized version of these tests only ever passed by the
    // accident of running on macOS in local development; the first real
    // Linux CI run - see cli.yml's `test` job - exposed that every one of
    // these "degrades gracefully" paths had never actually been verified).
    constructor({ aptPath = APT_PATH, dnfPath = DNF_PATH, pacmanPath = PACMAN_PATH, osReleasePath = OS_RELEASE_PATH, procVersionPath = PROC_VERSION_PATH } = {}) {
        super();
        this._pmPaths = { aptPath, dnfPath, pacmanPath };
        this._osReleasePath = osReleasePath;
        this._procVersionPath = procVersionPath;
    }

    _detectPackageManager() {
        return detectPackageManager(this._pmPaths);
    }

    get id() {
        return "linux";
    }

    get label() {
        return "Linux";
    }

    defaultShell() {
        return "bash";
    }

    shells() {
        return ["bash", "zsh"];
    }

    binSearchDirs() {
        return [path.join(homeDir(), ".local", "bin"), "/usr/local/bin", "/usr/bin"];
    }

    packageManagerId() {
        return this._detectPackageManager();
    }

    packageManagerCacheDir() {
        const pm = this._detectPackageManager();
        if (pm === "apt") return "/var/cache/apt/archives";
        if (pm === "dnf") return "/var/cache/dnf";
        if (pm === "pacman") return "/var/cache/pacman/pkg";
        return null;
    }

    // osVersion() - best-effort from /etc/os-release (the standard
    // freedesktop.org source every major distro ships), e.g.
    // "Ubuntu 24.04.1 LTS". Returns null if the file is missing/unreadable.
    async osVersion() {
        if (!existsSync(this._osReleasePath)) return null;
        try {
            const content = readFileSync(this._osReleasePath, "utf8");
            const match = /^PRETTY_NAME="?([^"\n]+)"?$/m.exec(content);
            return match ? match[1] : null;
        } catch {
            return null;
        }
    }

    // isWSL() - true when running inside Windows Subsystem for Linux.
    // Detected via /proc/version containing "microsoft".
    get wsl() {
        try {
            const content = readFileSync(this._procVersionPath, "utf8");
            return /microsoft/i.test(content);
        } catch {
            return false;
        }
    }

    installCommand(step, action) {
        if (["apt", "dnf", "pacman"].includes(step.method)) {
            assertSafePackageId(step.id, `${step.method} package id`);
        }
        switch (step.method) {
            case "apt":
                return action === "uninstall"
                    ? `sudo apt remove -y ${step.id}`
                    : `sudo apt update && sudo apt install -y ${step.id}`;
            case "dnf":
                return action === "uninstall"
                    ? `sudo dnf remove -y ${step.id}`
                    : `sudo dnf install -y ${step.id}`;
            case "pacman":
                return action === "uninstall"
                    ? `sudo pacman -Rns --noconfirm ${step.id}`
                    : `sudo pacman -S --noconfirm ${step.id}`;
            default:
                return super.installCommand(step, action);
        }
    }

    async packagePrefix(id) {
        const pm = this._detectPackageManager();
        if (!pm) return null;
        try {
            if (pm === "apt") {
                const { code, stdout } = await captureShellCommand(`dpkg -L ${id} 2>/dev/null | head -1`);
                if (code === 0 && stdout.trim()) return path.dirname(stdout.trim());
            }
            if (pm === "dnf") {
                const { code, stdout } = await captureShellCommand(`rpm -ql ${id} 2>/dev/null | head -1`);
                if (code === 0 && stdout.trim()) return path.dirname(stdout.trim());
            }
            if (pm === "pacman") {
                const { code, stdout } = await captureShellCommand(`pacman -Ql ${id} 2>/dev/null | head -1 | awk '{print $2}'`);
                if (code === 0 && stdout.trim()) return path.dirname(stdout.trim());
            }
        } catch {
            // ignore
        }
        return null;
    }

    async outdatedPackages() {
        const pm = this._detectPackageManager();
        if (!pm) return [];
        try {
            if (pm === "apt") {
                const { code, stdout } = await captureShellCommand("apt list --upgradable 2>/dev/null");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Listing"))
                    .map(l => l.split("/")[0])
                    .filter(Boolean);
            }
            if (pm === "dnf") {
                const { code, stdout } = await captureShellCommand("dnf check-update 2>/dev/null");
                if (code !== 0 && code !== 100) return [];
                return stdout.split("\n")
                    .filter(l => l && !l.startsWith("Last metadata") && !l.includes("updates"))
                    .map(l => l.split(" ")[0])
                    .filter(Boolean);
            }
            if (pm === "pacman") {
                const { code, stdout } = await captureShellCommand("pacman -Qu 2>/dev/null");
                if (code !== 0) return [];
                return stdout.split("\n")
                    .map(l => l.split(" ")[0])
                    .filter(Boolean);
            }
        } catch {
            // ignore
        }
        return [];
    }

    upgradeCommand(name) {
        assertSafePackageId(name, "package name");
        const pm = this._detectPackageManager();
        if (pm === "apt") return `sudo apt update && sudo apt upgrade -y ${name}`;
        if (pm === "dnf") return `sudo dnf upgrade -y ${name}`;
        if (pm === "pacman") return `sudo pacman -Syu --noconfirm ${name}`;
        throw new PlatformNotSupportedError("No supported Linux package manager detected");
    }
}
