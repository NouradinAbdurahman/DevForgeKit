// Installation Reliability Audit Engine (v1.3.x)
//
// Root cause fix for generic "install failed" messages. This module:
// 1. Diagnoses install failures by analyzing stderr patterns
// 2. Tracks per-package verification status
// 3. Logs every installation to ~/.devforgekit/logs/install/
// 4. Provides registry-wide audit (verify) and health check (doctor)
//
// The diagnosis engine pattern-matches against known failure signatures
// from Homebrew, npm, pip, cargo, mise, and shell installers to produce
// a precise failureReason + suggestedFix instead of a bare exit code.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadPackages } from "./registry.js";
import { userStateDir } from "./paths.js";
import { getPlatform } from "./platform/index.js";

export const INSTALL_AUDIT_VERSION = 2;

// Lazy path getters: computed at call time so tests that change HOME
// after import get the right paths (module-level constants would
// capture the original HOME at import time).
function getInstallLogDir() {
    return path.join(userStateDir(), "logs", "install");
}
function getVerificationFile() {
    return path.join(userStateDir(), "install-verification.json");
}

// Keep these for backward compat but make them lazy via getters
export const INSTALL_LOG_DIR = { }; // placeholder, use getInstallLogDir()
export const VERIFICATION_FILE = { }; // placeholder, use getVerificationFile()

// ─── Responsibility classification ────────────────────────────────────
export const RESPONSIBILITY = {
    USER: "User",
    VENDOR: "Vendor",
    DEVFORGEKIT: "DevForgeKit Registry",
    NONE: "None"
};

// ─── Installation status model (v2) ───────────────────────────────────
// Every package resolves to exactly one primary status. Each status
// carries an icon, a human-readable description, and a default
// responsibility classification so the user always knows who owns the
// problem.
export const INSTALL_STATUS = {
    VERIFIED: "verified",
    INSTALLED: "installed",
    UPDATE_AVAILABLE: "update-available",
    MANUAL_INSTALLATION: "manual-installation",
    AUTHENTICATION_REQUIRED: "authentication-required",
    LICENSE_REQUIRED: "license-required",
    MISSING_DEPENDENCY: "missing-dependency",
    NETWORK_ERROR: "network-error",
    TIMEOUT: "timeout",
    MISSING_PACKAGE_MANAGER: "missing-package-manager",
    UNSUPPORTED_PLATFORM: "unsupported-platform",
    UNSUPPORTED_ARCHITECTURE: "unsupported-architecture",
    DEPRECATED: "deprecated",
    BROKEN_REGISTRY_METADATA: "broken-registry-metadata",
    BROKEN_DOWNLOAD: "broken-download",
    REMOVED_BY_VENDOR: "removed-by-vendor",
    UNTESTED: "untested",
    NOT_INSTALLED: "not-installed",
    // Legacy aliases for backward compatibility with v1 tests/callers
    WORKING: "verified",
    BROKEN: "broken-registry-metadata",
    UNAVAILABLE: "removed-by-vendor",
    REQUIRES_MANUAL: "manual-installation",
    REQUIRES_LOGIN: "authentication-required",
    UNSUPPORTED: "unsupported-platform"
};

// Status metadata: icon, description, responsibility, canDevForgeKitFix,
// canUserFix. Used by TUI badges, CLI output, and diagnostics panels.
export const STATUS_META = {
    [INSTALL_STATUS.VERIFIED]: {
        icon: "✅", label: "Verified",
        description: "Successfully tested on this platform.",
        responsibility: RESPONSIBILITY.NONE,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.INSTALLED]: {
        icon: "🟢", label: "Installed",
        description: "Already installed.",
        responsibility: RESPONSIBILITY.NONE,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.UPDATE_AVAILABLE]: {
        icon: "🔄", label: "Update Available",
        description: "Installed but a newer version exists.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.MANUAL_INSTALLATION]: {
        icon: "⚠", label: "Manual Installation",
        description: "Automatic installation is not possible. Manual vendor installation is required.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.AUTHENTICATION_REQUIRED]: {
        icon: "🔐", label: "Authentication Required",
        description: "You must sign in before this package can be installed.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.LICENSE_REQUIRED]: {
        icon: "📄", label: "License Required",
        description: "The vendor requires acceptance of a license before installation.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.MISSING_DEPENDENCY]: {
        icon: "📦", label: "Missing Dependency",
        description: "Another component must be installed first.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.NETWORK_ERROR]: {
        icon: "🌐", label: "Network Error",
        description: "Temporary connection issue. Safe to retry.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.TIMEOUT]: {
        icon: "⏱", label: "Timeout",
        description: "Installation exceeded the timeout. Retry recommended.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.MISSING_PACKAGE_MANAGER]: {
        icon: "🔧", label: "Missing Package Manager",
        description: "The required package manager is missing.",
        responsibility: RESPONSIBILITY.USER,
        canDevForgeKitFix: false, canUserFix: true
    },
    [INSTALL_STATUS.UNSUPPORTED_PLATFORM]: {
        icon: "🚫", label: "Unsupported Platform",
        description: "The vendor does not support your operating system.",
        responsibility: RESPONSIBILITY.VENDOR,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.UNSUPPORTED_ARCHITECTURE]: {
        icon: "🚫", label: "Unsupported Architecture",
        description: "The package doesn't support this CPU architecture.",
        responsibility: RESPONSIBILITY.VENDOR,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.DEPRECATED]: {
        icon: "❌", label: "Deprecated",
        description: "The package has reached end-of-life. It has been replaced.",
        responsibility: RESPONSIBILITY.VENDOR,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.BROKEN_REGISTRY_METADATA]: {
        icon: "❌", label: "Broken Registry Metadata",
        description: "This is a DevForgeKit registry issue, not a user issue.",
        responsibility: RESPONSIBILITY.DEVFORGEKIT,
        canDevForgeKitFix: true, canUserFix: false
    },
    [INSTALL_STATUS.BROKEN_DOWNLOAD]: {
        icon: "❌", label: "Broken Download",
        description: "The download URL is invalid.",
        responsibility: RESPONSIBILITY.DEVFORGEKIT,
        canDevForgeKitFix: true, canUserFix: false
    },
    [INSTALL_STATUS.REMOVED_BY_VENDOR]: {
        icon: "❌", label: "Removed by Vendor",
        description: "Vendor removed the package.",
        responsibility: RESPONSIBILITY.VENDOR,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.UNTESTED]: {
        icon: "⚠", label: "Untested",
        description: "Package exists but has never been verified by DevForgeKit.",
        responsibility: RESPONSIBILITY.NONE,
        canDevForgeKitFix: false, canUserFix: false
    },
    [INSTALL_STATUS.NOT_INSTALLED]: {
        icon: "○", label: "Not Installed",
        description: "Not currently installed - run 'registry verify --install' to attempt a real installation.",
        responsibility: RESPONSIBILITY.NONE,
        canDevForgeKitFix: false, canUserFix: false
    }
};

// ─── Platform detection ───────────────────────────────────────────────
// Detects the current OS and CPU architecture so every diagnosis can
// answer "does this package support my platform?" Delegates to the
// core/platform/ adapter (v2.0.7) instead of its own
// process.platform/process.arch mapping - this used to be one of three
// independent copies of the same darwin/linux/win32 -> macos/linux/
// windows logic (the others were compatibility/engine.js's
// currentPlatform() and this file's own detectPlatformSync()).
export async function detectPlatform() {
    const platform = getPlatform();
    const osVersion = await platform.osVersion();
    return { os: platform.id, cpu: platform.architecture(), arch: process.arch, platform: process.platform, osVersion };
}

// Synchronous version for module-level use - osVersion is deliberately
// omitted here (every implementation shells out, so it can't be
// synchronous); callers needing it use detectPlatform() instead.
export function detectPlatformSync() {
    const platform = getPlatform();
    return { os: platform.id, cpu: platform.architecture(), arch: process.arch, platform: process.platform };
}

/**
 * Check if a package's declared platforms support the current OS.
 * Uses the package's `platforms` array (from manifest schema).
 * Returns { supported: boolean|null, reason: string }
 * null = unknown (no platform metadata)
 */
export function checkPlatformSupport(pkg) {
    const current = detectPlatformSync();
    if (!pkg.platforms || pkg.platforms.length === 0) {
        return { supported: null, reason: "No platform metadata available.", currentPlatform: current };
    }
    if (pkg.platforms.includes(current.os)) {
        return { supported: true, reason: `Supported on ${current.os}.`, currentPlatform: current };
    }
    const supportedList = pkg.platforms.join(", ");
    return {
        supported: false,
        reason: `Vendor does not support ${current.os}. Supported: ${supportedList}.`,
        currentPlatform: current,
        supportedPlatforms: pkg.platforms
    };
}

/**
 * Check if a package's declared architectures support the current CPU.
 * Uses the package's `architectures` array (from manifest schema).
 * Returns { supported: boolean|null, reason: string }
 */
export function checkArchitectureSupport(pkg) {
    const current = detectPlatformSync();
    if (!pkg.architectures || pkg.architectures.length === 0) {
        return { supported: null, reason: "No architecture metadata available.", currentArch: current.cpu };
    }
    // Map manifest arch names to detected cpu
    const archMap = {
        "intel": "intel",
        "apple-silicon": "apple-silicon",
        "linux": "linux"
    };
    const supported = pkg.architectures.some((a) => archMap[a] === current.cpu);
    if (supported) {
        return { supported: true, reason: `Supported on ${current.cpu}.`, currentArch: current.cpu };
    }
    return {
        supported: false,
        reason: `Package does not support ${current.cpu}. Supported: ${pkg.architectures.join(", ")}.`,
        currentArch: current.cpu,
        supportedArchitectures: pkg.architectures
    };
}

// Failure reason categories
export const FAILURE_REASONS = {
    PACKAGE_NOT_FOUND: "package_not_found",
    PACKAGE_RENAMED: "package_renamed",
    TAP_REQUIRED: "tap_required",
    PACKAGE_MANAGER_MISSING: "package_manager_missing",
    DEPENDENCY_MISSING: "dependency_missing",
    UNSUPPORTED_ARCH: "unsupported_arch",
    UNSUPPORTED_OS: "unsupported_os",
    REQUIRES_AUTH: "requires_auth",
    REQUIRES_LICENSE: "requires_license",
    INTERACTIVE_INSTALLER: "interactive_installer",
    INSTALL_TIMEOUT: "install_timeout",
    ALREADY_INSTALLED: "already_installed",
    NETWORK_ERROR: "network_error",
    PERMISSION_DENIED: "permission_denied",
    DISK_SPACE: "disk_space",
    BROKEN_DOWNLOAD: "broken_download",
    BROKEN_METADATA: "broken_metadata",
    REMOVED_BY_VENDOR: "removed_by_vendor",
    UNKNOWN: "unknown"
};

// ─── Diagnosis patterns ───────────────────────────────────────────────
// Each pattern matches against stderr text and produces a structured
// failure reason + suggested fix. Patterns are ordered by specificity:
// more specific patterns should come first.

const DIAGNOSIS_PATTERNS = [
    // Homebrew: formula does not exist
    {
        test: /Error: (?:No available formula|No formulae|No cask)/i,
        reason: FAILURE_REASONS.PACKAGE_NOT_FOUND,
        category: "brew",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "Formula or cask does not exist in Homebrew.",
        fix: (cmd, _stderr) => {
            const nameMatch = cmd.match(/(?:brew install(?:\s+--cask)?\s+)(\S+)/);
            const name = nameMatch ? nameMatch[1] : "the package";
            return `The Homebrew formula '${name}' was not found. It may have been renamed, removed, or requires a tap. Search for alternatives: brew search ${name}`;
        }
    },
    // Homebrew: package renamed (formula was renamed)
    {
        test: /Error: (?:(?:No available formula|No available formula with the name)|formula.*renamed|was renamed)/i,
        reason: FAILURE_REASONS.PACKAGE_RENAMED,
        category: "brew",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "Formula was renamed in Homebrew.",
        fix: (cmd) => {
            const nameMatch = cmd.match(/brew install(?:\s+--cask)?\s+(\S+)/);
            const name = nameMatch ? nameMatch[1] : "the package";
            return `The formula '${name}' was renamed. Run: brew search ${name} to find the new name.`;
        }
    },
    // Homebrew: tap required
    {
        test: /Error: (?:No available formula|No cask).*tap|Please tap/i,
        reason: FAILURE_REASONS.TAP_REQUIRED,
        category: "brew",
        responsibility: RESPONSIBILITY.USER,
        message: "Requires a Homebrew tap that is not added.",
        fix: (cmd, stderr) => {
            const tapMatch = stderr.match(/tap\s+([\w/-]+\/[\w-]+)/i);
            if (tapMatch) return `Run: brew tap ${tapMatch[1]} then retry the install.`;
            return "A Homebrew tap is required. Check the package documentation for the correct tap.";
        }
    },
    // Homebrew: already installed
    {
        test: /Warning: .*already installed/i,
        reason: FAILURE_REASONS.ALREADY_INSTALLED,
        category: "brew",
        responsibility: RESPONSIBILITY.NONE,
        message: "Package is already installed.",
        fix: () => "The package is already installed. If detection failed, try: brew unlink && brew link <name>"
    },
    // npm: package not found
    {
        test: /npm ERR!.*404|npm ERR!.*not found|code E404/i,
        reason: FAILURE_REASONS.PACKAGE_NOT_FOUND,
        category: "npm",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "npm package does not exist.",
        fix: (cmd) => {
            const nameMatch = cmd.match(/npm install -g (\S+)/);
            const name = nameMatch ? nameMatch[1] : "the package";
            return `The npm package '${name}' was not found. It may have been renamed or removed. Search: npm search ${name}`;
        }
    },
    // npm: ERESOLVE dependency conflict
    {
        test: /npm ERR!.*ERESOLVE|npm ERR!.*peer dep/i,
        reason: FAILURE_REASONS.DEPENDENCY_MISSING,
        category: "npm",
        responsibility: RESPONSIBILITY.USER,
        message: "npm dependency resolution conflict.",
        fix: () => "A peer dependency conflict occurred. Try: npm install -g <name> --legacy-peer-deps"
    },
    // npm: requires login
    {
        test: /npm ERR!.*ENEEDAUTH|npm ERR!.*requires authentication/i,
        reason: FAILURE_REASONS.REQUIRES_AUTH,
        category: "npm",
        responsibility: RESPONSIBILITY.USER,
        message: "npm package requires authentication.",
        fix: () => "This package requires npm login. Run: npm login then retry."
    },
    // pip: package not found
    {
        test: /ERROR: No matching distribution|Could not find a version/i,
        reason: FAILURE_REASONS.PACKAGE_NOT_FOUND,
        category: "pip",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "pip package does not exist or no compatible version found.",
        fix: (cmd) => {
            const nameMatch = cmd.match(/pip install (\S+)/);
            const name = nameMatch ? nameMatch[1] : "the package";
            return `The pip package '${name}' was not found. It may have been renamed. Search: pip search ${name} or check PyPI.org`;
        }
    },
    // pip: requires login / private repo
    {
        test: /ERROR:.*403|ERROR:.*authentication|ERROR:.*credentials/i,
        reason: FAILURE_REASONS.REQUIRES_AUTH,
        category: "pip",
        responsibility: RESPONSIBILITY.USER,
        message: "pip package requires authentication.",
        fix: () => "This package requires authentication. Configure pip credentials or use a token."
    },
    // cargo: package not found
    {
        test: /error: could not find.*in registry|error: no package named/i,
        reason: FAILURE_REASONS.PACKAGE_NOT_FOUND,
        category: "cargo",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "cargo crate does not exist.",
        fix: (cmd) => {
            const nameMatch = cmd.match(/cargo install (\S+)/);
            const name = nameMatch ? nameMatch[1] : "the package";
            return `The cargo crate '${name}' was not found. Search: cargo search ${name}`;
        }
    },
    // mise: tool not found
    {
        test: /mise.*no such tool|mise.*not found/i,
        reason: FAILURE_REASONS.PACKAGE_NOT_FOUND,
        category: "mise",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "mise tool does not exist.",
        fix: (cmd) => {
            const nameMatch = cmd.match(/mise use -g (\S+)/);
            const name = nameMatch ? nameMatch[1] : "the tool";
            return `The mise tool '${name}' was not found. List available: mise list-all ${name.split('@')[0]}`;
        }
    },
    // General: command not found (package manager missing)
    {
        test: /command not found|No such file or directory.*brew|No such file or directory.*npm|No such file or directory.*pip|No such file or directory.*cargo/i,
        reason: FAILURE_REASONS.PACKAGE_MANAGER_MISSING,
        category: "general",
        responsibility: RESPONSIBILITY.USER,
        message: "Package manager is not installed.",
        fix: (cmd) => {
            if (/brew/.test(cmd)) return "Homebrew is not installed. Install it: /bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"";
            if (/npm/.test(cmd)) return "npm is not installed. Install Node.js first: https://nodejs.org/";
            if (/pip/.test(cmd)) return "pip is not installed. Install Python first: https://python.org/";
            if (/cargo/.test(cmd)) return "cargo is not installed. Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh";
            return "The required package manager is not installed.";
        }
    },
    // General: unsupported architecture
    {
        test: /unsupported.*architecture|not.*arm64|not.*aarch64|requires.*x86|Intel only/i,
        reason: FAILURE_REASONS.UNSUPPORTED_ARCH,
        category: "general",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "Package is not supported on this CPU architecture.",
        fix: () => "This package does not support your CPU architecture (Apple Silicon / ARM64). Check if an alternative exists or use Rosetta."
    },
    // General: unsupported OS
    {
        test: /unsupported.*OS|not.*available.*macOS|Linux only|macOS only/i,
        reason: FAILURE_REASONS.UNSUPPORTED_OS,
        category: "general",
        responsibility: RESPONSIBILITY.VENDOR,
        message: "Package is not supported on this operating system.",
        fix: () => "This package does not support your operating system. Check the package documentation for supported platforms."
    },
    // General: permission denied
    {
        test: /Permission denied|EACCES|operation not permitted/i,
        reason: FAILURE_REASONS.PERMISSION_DENIED,
        category: "general",
        responsibility: RESPONSIBILITY.USER,
        message: "Permission denied during installation.",
        fix: () => "Permission denied. Try running with appropriate permissions or check directory ownership."
    },
    // General: disk space
    {
        test: /No space left|ENOSPC|disk full/i,
        reason: FAILURE_REASONS.DISK_SPACE,
        category: "general",
        responsibility: RESPONSIBILITY.USER,
        message: "Not enough disk space.",
        fix: () => "Not enough disk space for installation. Free up space and retry."
    },
    // General: network error
    {
        test: /Connection refused|Network unreachable|ENOTFOUND|ECONNREFUSED|curl:.*Could not resolve|fetch failed/i,
        reason: FAILURE_REASONS.NETWORK_ERROR,
        category: "general",
        responsibility: RESPONSIBILITY.USER,
        message: "Network error during installation.",
        fix: () => "A network error occurred. Check your internet connection and retry."
    },
    // General: interactive installer
    {
        test: /interactive|requires.*input|press.*enter|confirm/i,
        reason: FAILURE_REASONS.INTERACTIVE_INSTALLER,
        category: "general",
        responsibility: RESPONSIBILITY.USER,
        message: "Installer requires interactive input.",
        fix: () => "This installer requires interactive input. Run it manually in a terminal: <command>"
    },
    // General: timeout
    {
        test: /timed out|timeout|SIGTERM/i,
        reason: FAILURE_REASONS.INSTALL_TIMEOUT,
        category: "general",
        responsibility: RESPONSIBILITY.USER,
        message: "Installation timed out.",
        fix: () => "The installation timed out. Retry, or run manually: <command>"
    },
    // General: broken download URL
    {
        test: /curl:.*404|wget.*404|download.*failed.*404|Not Found.*download/i,
        reason: FAILURE_REASONS.BROKEN_DOWNLOAD,
        category: "general",
        responsibility: RESPONSIBILITY.DEVFORGEKIT,
        message: "Download URL is invalid or returns 404.",
        fix: () => "The download URL in the package manifest is broken. This is a DevForgeKit registry issue. Report it or update the manifest."
    }
];

/**
 * Diagnose an installation failure from stderr output.
 *
 * @param {string} command - The command that was run
 * @param {string} stderr - The stderr output
 * @param {number} exitCode - The exit code
 * @param {boolean} timedOut - Whether the command timed out
 * @returns {{ reason, category, message, suggestedFix, responsibility, canDevForgeKitFix, canUserFix }}
 */
export function diagnoseFailure(command, stderr, exitCode, timedOut = false) {
    if (timedOut) {
        return {
            reason: FAILURE_REASONS.INSTALL_TIMEOUT,
            category: "general",
            message: "Installation timed out.",
            suggestedFix: `The installation timed out. Retry, or run manually: ${command}`,
            responsibility: RESPONSIBILITY.USER,
            canDevForgeKitFix: false,
            canUserFix: true
        };
    }

    const combined = `${stderr}\n${command}`;

    for (const pattern of DIAGNOSIS_PATTERNS) {
        if (pattern.test.test(combined)) {
            return {
                reason: pattern.reason,
                category: pattern.category,
                message: pattern.message,
                suggestedFix: pattern.fix(command, stderr),
                responsibility: pattern.responsibility,
                canDevForgeKitFix: pattern.responsibility === RESPONSIBILITY.DEVFORGEKIT,
                canUserFix: pattern.responsibility === RESPONSIBILITY.USER
            };
        }
    }

    // Unknown failure: still provide structured info
    const stderrSnippet = stderr ? stderr.slice(0, 200) : "No stderr output";
    return {
        reason: FAILURE_REASONS.UNKNOWN,
        category: "general",
        message: `Installation failed with exit code ${exitCode}.`,
        suggestedFix: `Installation exited with code ${exitCode}. Stderr: ${stderrSnippet}`,
        responsibility: RESPONSIBILITY.NONE,
        canDevForgeKitFix: false,
        canUserFix: false
    };
}

/**
 * Map a failure reason to an installation status.
 */
export function mapFailureToStatus(reason) {
    switch (reason) {
        case FAILURE_REASONS.PACKAGE_NOT_FOUND:
        case FAILURE_REASONS.PACKAGE_RENAMED:
            return INSTALL_STATUS.REMOVED_BY_VENDOR;
        case FAILURE_REASONS.UNSUPPORTED_ARCH:
            return INSTALL_STATUS.UNSUPPORTED_ARCHITECTURE;
        case FAILURE_REASONS.UNSUPPORTED_OS:
            return INSTALL_STATUS.UNSUPPORTED_PLATFORM;
        case FAILURE_REASONS.REQUIRES_AUTH:
            return INSTALL_STATUS.AUTHENTICATION_REQUIRED;
        case FAILURE_REASONS.REQUIRES_LICENSE:
            return INSTALL_STATUS.LICENSE_REQUIRED;
        case FAILURE_REASONS.INTERACTIVE_INSTALLER:
        case FAILURE_REASONS.PERMISSION_DENIED:
            return INSTALL_STATUS.MANUAL_INSTALLATION;
        case FAILURE_REASONS.PACKAGE_MANAGER_MISSING:
            return INSTALL_STATUS.MISSING_PACKAGE_MANAGER;
        case FAILURE_REASONS.DEPENDENCY_MISSING:
            return INSTALL_STATUS.MISSING_DEPENDENCY;
        case FAILURE_REASONS.NETWORK_ERROR:
            return INSTALL_STATUS.NETWORK_ERROR;
        case FAILURE_REASONS.INSTALL_TIMEOUT:
            return INSTALL_STATUS.TIMEOUT;
        case FAILURE_REASONS.BROKEN_DOWNLOAD:
            return INSTALL_STATUS.BROKEN_DOWNLOAD;
        case FAILURE_REASONS.BROKEN_METADATA:
            return INSTALL_STATUS.BROKEN_REGISTRY_METADATA;
        case FAILURE_REASONS.REMOVED_BY_VENDOR:
            return INSTALL_STATUS.REMOVED_BY_VENDOR;
        default:
            return INSTALL_STATUS.BROKEN_REGISTRY_METADATA;
    }
}

/**
 * Log an installation result to ~/.devforgekit/logs/install/<name>.log
 */
export function logInstallation(packageName, result) {
    try {
        const installLogDir = getInstallLogDir();
        mkdirSync(installLogDir, { recursive: true });
        const logFile = path.join(installLogDir, `${packageName}.log`);
        const entry = {
            timestamp: result.timestamp,
            installer: result.installer,
            command: result.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            duration: `${result.elapsedMs}ms`,
            result: result.success ? "success" : "failed",
            failureReason: result.failureReason || null,
            failureMessage: result.failureMessage || null,
            suggestedFix: result.suggestedFix || null
        };
        // Append to existing log (keep last 10 entries per package)
        let entries = [];
        if (existsSync(logFile)) {
            try {
                const existing = JSON.parse(readFileSync(logFile, "utf-8"));
                entries = Array.isArray(existing) ? existing : [existing];
            } catch {
                entries = [];
            }
        }
        entries.push(entry);
        if (entries.length > 10) entries = entries.slice(-10);
        writeFileSync(logFile, JSON.stringify(entries, null, 2) + "\n");
    } catch {
        // Logging is best-effort; never fail an install because logging failed
    }
}

/**
 * Read the install log for a package.
 */
export function readInstallLog(packageName) {
    const logFile = path.join(getInstallLogDir(), `${packageName}.log`);
    if (!existsSync(logFile)) return [];
    try {
        const data = JSON.parse(readFileSync(logFile, "utf-8"));
        return Array.isArray(data) ? data : [data];
    } catch {
        return [];
    }
}

// ─── Verification status tracking ─────────────────────────────────────

/**
 * Load the verification status for all packages.
 */
export function loadVerificationStatuses() {
    const verFile = getVerificationFile();
    if (!existsSync(verFile)) return {};
    try {
        return JSON.parse(readFileSync(verFile, "utf-8"));
    } catch {
        return {};
    }
}

/**
 * Update the verification status for a single package.
 */
export function updateVerificationStatus(packageName, status, verifiedAt, failureReason, failureMessage) {
    try {
        const verFile = getVerificationFile();
        const all = loadVerificationStatuses();
        all[packageName] = {
            status,
            verifiedAt,
            failureReason: failureReason || null,
            failureMessage: failureMessage || null
        };
        mkdirSync(path.dirname(verFile), { recursive: true });
        writeFileSync(verFile, JSON.stringify(all, null, 2) + "\n");
    } catch {
        // Best-effort
    }
}

/**
 * Get the verification status for a single package.
 */
export function getVerificationStatus(packageName) {
    const all = loadVerificationStatuses();
    return all[packageName] || { status: INSTALL_STATUS.UNTESTED, verifiedAt: null };
}

// ─── Registry-wide audit ──────────────────────────────────────────────

/**
 * Verify a single package: by default, only checks whether it's already
 * installed (real `pkg.validate` shell command - read-only, never
 * modifies anything). Only attempts a REAL package-manager install for
 * a not-yet-installed package when `attemptInstall: true` is explicitly
 * passed - this used to happen unconditionally, which meant `devforgekit
 * registry verify` silently installed real software for every one of
 * the ~261 registry packages not already present, despite "verify"
 * being a name every other read-only-sounding command in this CLI
 * (audit/check/doctor/lint/stats/list/...) is held to never do. See
 * SECURITY.md / docs/CommandSafety.md for the naming convention this
 * enforces: a command without an explicit mutating verb (install/
 * remove/repair/regenerate/...) must never modify the user's machine.
 *
 * @param {Object} pkg - Package manifest
 * @param {Object} options - { onProgress, timeoutMs, attemptInstall }
 * @returns {Promise<Object>} - Verification result
 */
export async function verifyPackage(pkg, { onProgress, timeoutMs, attemptInstall = false } = {}) {
    // Dynamic import to avoid circular dependency (installer.js imports
    // from installAudit.js for diagnoseFailure/logInstallation)
    const { validate, installWithDetails } = await import("./installer.js");

    // First check if already installed via validate
    let alreadyInstalled = false;
    if (pkg.validate) {
        try {
            const code = await validate(pkg);
            alreadyInstalled = code === 0;
        } catch {
            alreadyInstalled = false;
        }
    }

    if (alreadyInstalled) {
        const result = {
            name: pkg.name,
            status: INSTALL_STATUS.VERIFIED,
            verifiedAt: new Date().toISOString(),
            method: "validate",
            success: true
        };
        updateVerificationStatus(pkg.name, INSTALL_STATUS.VERIFIED, result.verifiedAt);
        if (onProgress) onProgress(result);
        return result;
    }

    if (!attemptInstall) {
        const result = {
            name: pkg.name,
            status: INSTALL_STATUS.NOT_INSTALLED,
            verifiedAt: new Date().toISOString(),
            method: "validate",
            success: false
        };
        if (onProgress) onProgress(result);
        return result;
    }

    // Attempt actual installation using installWithDetails for structured errors
    const installResult = await installWithDetails(pkg, null, { timeoutMs });

    const result = {
        name: pkg.name,
        status: installResult.success ? INSTALL_STATUS.VERIFIED : mapFailureToStatus(installResult.failureReason),
        verifiedAt: installResult.timestamp,
        method: "install",
        success: installResult.success,
        exitCode: installResult.exitCode,
        failureReason: installResult.failureReason,
        failureMessage: installResult.failureMessage,
        suggestedFix: installResult.suggestedFix,
        elapsedMs: installResult.elapsedMs
    };

    // Update verification status
    if (installResult.success) {
        updateVerificationStatus(pkg.name, INSTALL_STATUS.VERIFIED, result.verifiedAt);
    } else {
        updateVerificationStatus(pkg.name, result.status, result.verifiedAt, installResult.failureReason, installResult.failureMessage);
    }

    if (onProgress) onProgress(result);
    return result;
}

/**
 * Verify all registry packages.
 *
 * @param {Object} options - { onProgress, timeoutMs, packages }
 * @returns {Promise<Object>} - { results, summary }
 */
export async function verifyAllPackages({ onProgress, timeoutMs, packages, attemptInstall = false } = {}) {
    const pkgs = packages || loadPackages();
    const results = [];

    for (let i = 0; i < pkgs.length; i++) {
        const pkg = pkgs[i];
        const result = await verifyPackage(pkg, { onProgress, timeoutMs, attemptInstall });
        results.push(result);
    }

    const summary = buildVerificationSummary(results);
    return { results, summary };
}

/**
 * Build a summary from verification results.
 */
export function buildVerificationSummary(results) {
    const summary = {
        total: results.length,
        verified: 0,
        installed: 0,
        updateAvailable: 0,
        manualInstallation: 0,
        authenticationRequired: 0,
        licenseRequired: 0,
        missingDependency: 0,
        networkError: 0,
        timeout: 0,
        missingPackageManager: 0,
        unsupportedPlatform: 0,
        unsupportedArchitecture: 0,
        deprecated: 0,
        brokenRegistryMetadata: 0,
        brokenDownload: 0,
        removedByVendor: 0,
        untested: 0,
        notInstalled: 0,
        successRate: 0,
        reliability: 0
    };

    for (const r of results) {
        switch (r.status) {
            case INSTALL_STATUS.VERIFIED:
                summary.verified++;
                break;
            case INSTALL_STATUS.INSTALLED:
                summary.installed++;
                break;
            case INSTALL_STATUS.UPDATE_AVAILABLE:
                summary.updateAvailable++;
                break;
            case INSTALL_STATUS.MANUAL_INSTALLATION:
                summary.manualInstallation++;
                break;
            case INSTALL_STATUS.AUTHENTICATION_REQUIRED:
                summary.authenticationRequired++;
                break;
            case INSTALL_STATUS.LICENSE_REQUIRED:
                summary.licenseRequired++;
                break;
            case INSTALL_STATUS.MISSING_DEPENDENCY:
                summary.missingDependency++;
                break;
            case INSTALL_STATUS.NETWORK_ERROR:
                summary.networkError++;
                break;
            case INSTALL_STATUS.TIMEOUT:
                summary.timeout++;
                break;
            case INSTALL_STATUS.MISSING_PACKAGE_MANAGER:
                summary.missingPackageManager++;
                break;
            case INSTALL_STATUS.UNSUPPORTED_PLATFORM:
                summary.unsupportedPlatform++;
                break;
            case INSTALL_STATUS.UNSUPPORTED_ARCHITECTURE:
                summary.unsupportedArchitecture++;
                break;
            case INSTALL_STATUS.DEPRECATED:
                summary.deprecated++;
                break;
            case INSTALL_STATUS.BROKEN_REGISTRY_METADATA:
                summary.brokenRegistryMetadata++;
                break;
            case INSTALL_STATUS.BROKEN_DOWNLOAD:
                summary.brokenDownload++;
                break;
            case INSTALL_STATUS.REMOVED_BY_VENDOR:
                summary.removedByVendor++;
                break;
            case INSTALL_STATUS.NOT_INSTALLED:
                summary.notInstalled++;
                break;
            default:
                summary.untested++;
                break;
        }
    }

    // successRate = verified + installed as fraction of total
    const good = summary.verified + summary.installed;
    summary.successRate = summary.total > 0
        ? Math.round((good / summary.total) * 1000) / 10
        : 0;

    // reliability = verified + installed + updateAvailable as fraction of total
    // (update-available is still a working package, just outdated)
    const working = good + summary.updateAvailable;
    summary.reliability = summary.total > 0
        ? Math.round((working / summary.total) * 1000) / 10
        : 0;

    return summary;
}

// ─── Registry doctor ──────────────────────────────────────────────────

/**
 * Run a registry health check: find broken formulas, missing commands,
 * dead URLs, duplicates, and other registry quality issues.
 *
 * Extended in v2 to detect: missing platform metadata, missing replacement
 * for deprecated packages, broken documentation URL, missing category,
 * missing quality score, broken dependencies, missing supported package
 * managers, and to generate an overall registry quality score.
 *
 * @param {Object} options - { packages }
 * @returns {Object} - { issues, summary, qualityScore }
 */
export function registryDoctor({ packages } = {}) {
    const pkgs = packages || loadPackages();
    const issues = [];

    // ── Per-package structural checks ────────────────────────────────
    for (const pkg of pkgs) {
        if (!pkg.validate) {
            issues.push({
                package: pkg.name,
                type: "missing_validate",
                severity: "warning",
                message: "No validate command defined - cannot verify installation."
            });
        }
        if (!pkg.update) {
            issues.push({
                package: pkg.name,
                type: "missing_update",
                severity: "info",
                message: "No update command defined."
            });
        }
        if (!pkg.uninstall) {
            issues.push({
                package: pkg.name,
                type: "missing_uninstall",
                severity: "info",
                message: "No uninstall command defined."
            });
        }
        if (!pkg.install && !pkg.variants) {
            issues.push({
                package: pkg.name,
                type: "missing_install",
                severity: "error",
                message: "No install command defined."
            });
        }
        if (!pkg.homepage) {
            issues.push({
                package: pkg.name,
                type: "missing_homepage",
                severity: "info",
                message: "No homepage URL defined."
            });
        }
        if (!pkg.repository) {
            issues.push({
                package: pkg.name,
                type: "missing_repository",
                severity: "info",
                message: "No repository URL defined."
            });
        }
        // Missing platform metadata
        if (!pkg.platforms || pkg.platforms.length === 0) {
            issues.push({
                package: pkg.name,
                type: "missing_platform_metadata",
                severity: "warning",
                message: "No platform support metadata defined."
            });
        }
        // Missing architecture metadata
        if (!pkg.architectures || pkg.architectures.length === 0) {
            issues.push({
                package: pkg.name,
                type: "missing_architecture_metadata",
                severity: "info",
                message: "No architecture support metadata defined."
            });
        }
        // Missing documentation URL
        if (!pkg.documentation) {
            issues.push({
                package: pkg.name,
                type: "missing_documentation",
                severity: "info",
                message: "No documentation URL defined."
            });
        }
        // Missing category
        if (!pkg.category) {
            issues.push({
                package: pkg.name,
                type: "missing_category",
                severity: "warning",
                message: "No category defined."
            });
        }
        // Deprecated without replacement
        if (pkg.stability === "deprecated" && (!pkg.recommendedAlternatives || pkg.recommendedAlternatives.length === 0)) {
            issues.push({
                package: pkg.name,
                type: "deprecated_without_replacement",
                severity: "warning",
                message: "Package is deprecated but has no recommended replacement defined."
            });
        }
        // Broken dependencies (references unknown packages)
        const allNames = new Set(pkgs.map((p) => p.name));
        for (const dep of pkg.dependencies || []) {
            if (!allNames.has(dep)) {
                issues.push({
                    package: pkg.name,
                    type: "broken_dependency",
                    severity: "error",
                    message: `Dependency '${dep}' is not a known registry package.`
                });
            }
        }
    }

    // ── Duplicate alias check ────────────────────────────────────────
    const aliasMap = new Map();
    for (const pkg of pkgs) {
        for (const alias of pkg.aliases || []) {
            if (aliasMap.has(alias)) {
                issues.push({
                    package: pkg.name,
                    type: "duplicate_alias",
                    severity: "warning",
                    message: `Alias '${alias}' is also claimed by '${aliasMap.get(alias)}'.`
                });
            } else {
                aliasMap.set(alias, pkg.name);
            }
        }
    }

    // ── Verification status checks ──────────────────────────────────
    const verifications = loadVerificationStatuses();
    for (const pkg of pkgs) {
        if (!verifications[pkg.name]) {
            issues.push({
                package: pkg.name,
                type: "never_tested",
                severity: "info",
                message: "Package has never been install-verified."
            });
        }
    }

    // Check for broken packages (from verification status)
    for (const [name, ver] of Object.entries(verifications)) {
        if (ver.status === INSTALL_STATUS.BROKEN_REGISTRY_METADATA || ver.status === INSTALL_STATUS.BROKEN_DOWNLOAD) {
            issues.push({
                package: name,
                type: ver.status === INSTALL_STATUS.BROKEN_DOWNLOAD ? "broken_download" : "broken_metadata",
                severity: "error",
                message: ver.failureMessage || "Package installation is broken."
            });
        }
    }

    // ── Deprecated stability check ──────────────────────────────────
    for (const pkg of pkgs) {
        if (pkg.stability === "deprecated") {
            issues.push({
                package: pkg.name,
                type: "deprecated",
                severity: "warning",
                message: "Package is marked as deprecated."
            });
        }
    }

    // ── Quality score ───────────────────────────────────────────────
    // Registry health = (packages without errors) / total * 100
    const errorPackages = new Set(issues.filter((i) => i.severity === "error").map((i) => i.package));
    const qualityScore = pkgs.length > 0
        ? Math.round(((pkgs.length - errorPackages.size) / pkgs.length) * 1000) / 10
        : 100;

    const summary = {
        total: pkgs.length,
        issues: issues.length,
        errors: issues.filter((i) => i.severity === "error").length,
        warnings: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
        qualityScore
    };

    return { issues, summary };
}

// ─── Package diagnostics ──────────────────────────────────────────────

/**
 * Build a full diagnostics object for a package, suitable for display in
 * the TUI detail panel or CLI `info` output. Combines:
 * - Current install status (from verification tracking)
 * - Platform support check
 * - Architecture support check
 * - Responsibility classification
 * - Why explanation (reason, canDevForgeKitFix, canUserFix, suggestedFix)
 * - Alternative packages
 * - Verification history
 *
 * @param {Object} pkg - Package manifest
 * @param {Object[]} allPackages - All registry packages (for alternatives)
 * @returns {Object} - Full diagnostics object
 */
export function getPackageDiagnostics(pkg, allPackages) {
    const ver = getVerificationStatus(pkg.name);
    const platformCheck = checkPlatformSupport(pkg);
    const archCheck = checkArchitectureSupport(pkg);
    const meta = STATUS_META[ver.status] || STATUS_META[INSTALL_STATUS.UNTESTED];

    // Determine alternatives
    const alternatives = (pkg.recommendedAlternatives || [])
        .filter((name) => allPackages?.some((p) => p.name === name))
        .concat(
            (allPackages || [])
                .filter((p) => p.name !== pkg.name && p.category === pkg.category && p.stability !== "deprecated")
                .map((p) => p.name)
                .slice(0, 3)
        )
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 5);

    // Build the "Why" section
    const why = {
        reason: ver.failureMessage || meta.description,
        canDevForgeKitFix: meta.canDevForgeKitFix,
        canUserFix: meta.canUserFix,
        suggestedFix: ver.failureReason ? `Run: devforgekit component repair ${pkg.name} or follow the suggested fix.` : null,
        alternativePackages: alternatives,
        documentation: pkg.documentation || pkg.homepage || null
    };

    // Verification history
    const history = readInstallLog(pkg.name);

    return {
        package: pkg.name,
        status: ver.status,
        statusIcon: meta.icon,
        statusLabel: meta.label,
        statusDescription: meta.description,
        responsibility: meta.responsibility,
        platformSupport: platformCheck,
        architectureSupport: archCheck,
        why,
        alternatives,
        verificationHistory: history,
        lastVerified: ver.verifiedAt || pkg.lastVerified || null,
        installCommand: pkg.install ? (pkg.install.method || pkg.install.command || null) : null,
        validateCommand: pkg.validate || null,
        homepage: pkg.homepage || null,
        documentation: pkg.documentation || null
    };
}

/**
 * Format an installation failure as a rich, human-readable block for CLI
 * output. Replaces generic "Install failed." with a structured report.
 *
 * @param {Object} installResult - The result from installWithDetails
 * @param {Object} pkg - Package manifest
 * @param {Object[]} allPackages - All registry packages (for alternatives)
 * @returns {string} - Formatted multi-line output
 */
export function formatInstallFailure(installResult, pkg, allPackages) {
    const diagnosis = diagnoseFailure(installResult.command, installResult.stderr, installResult.exitCode, installResult.timedOut);
    const status = mapFailureToStatus(diagnosis.reason);
    const meta = STATUS_META[status] || STATUS_META[INSTALL_STATUS.UNTESTED];
    const platformCheck = checkPlatformSupport(pkg);
    const archCheck = checkArchitectureSupport(pkg);

    const alternatives = (pkg.recommendedAlternatives || [])
        .concat(
            (allPackages || [])
                .filter((p) => p.name !== pkg.name && p.category === pkg.category && p.stability !== "deprecated")
                .map((p) => p.name)
                .slice(0, 3)
        )
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 5);

    const lines = [
        "Installation Failed",
        `  Package:          ${pkg.name}`,
        `  Status:           ${meta.icon} ${meta.label}`,
        `  Reason:           ${diagnosis.message}`,
        `  Responsible:      ${diagnosis.responsibility}`,
        `  Can DevForgeKit fix? ${diagnosis.canDevForgeKitFix ? "Yes" : "No"}`,
        `  Can user fix?     ${diagnosis.canUserFix ? "Yes" : "No"}`,
        `  Suggested Fix:    ${diagnosis.suggestedFix}`
    ];

    if (alternatives.length > 0) {
        lines.push(`  Alternatives:     ${alternatives.join(", ")}`);
    }
    if (pkg.documentation || pkg.homepage) {
        lines.push(`  Documentation:    ${pkg.documentation || pkg.homepage}`);
    }
    if (platformCheck.supported === false) {
        lines.push(`  Platform:         ${platformCheck.reason}`);
    }
    if (archCheck.supported === false) {
        lines.push(`  Architecture:     ${archCheck.reason}`);
    }
    if (installResult.exitCode !== 0) {
        lines.push(`  Exit Code:        ${installResult.exitCode}`);
    }

    return lines.join("\n");
}
