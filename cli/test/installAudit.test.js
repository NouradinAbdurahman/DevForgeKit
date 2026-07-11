import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
    INSTALL_AUDIT_VERSION,
    INSTALL_STATUS,
    FAILURE_REASONS,
    RESPONSIBILITY,
    STATUS_META,
    diagnoseFailure,
    buildVerificationSummary,
    logInstallation,
    readInstallLog,
    loadVerificationStatuses,
    updateVerificationStatus,
    getVerificationStatus,
    registryDoctor,
    detectPlatformSync,
    checkPlatformSupport,
    checkArchitectureSupport,
    mapFailureToStatus,
    getPackageDiagnostics,
    formatInstallFailure,
    verifyPackage,
    verifyAllPackages
} from "../src/core/installAudit.js";

async function withTempHomeAsync(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-audit-test-"));
    process.env.HOME = tempHome;
    try {
        return await fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// Point HOME at a scratch directory to isolate from the developer's real
// ~/.devforgekit (same pattern as all other test files).
function withTempHome(fn) {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-audit-test-"));
    process.env.HOME = tempHome;
    try {
        return fn(tempHome);
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true });
    }
}

// ─── Constants ────────────────────────────────────────────────────────

test("INSTALL_AUDIT_VERSION is 2", () => {
    assert.equal(INSTALL_AUDIT_VERSION, 2);
});

test("INSTALL_STATUS has all required statuses", () => {
    assert.ok(INSTALL_STATUS.VERIFIED);
    assert.ok(INSTALL_STATUS.WORKING);
    assert.ok(INSTALL_STATUS.BROKEN);
    assert.ok(INSTALL_STATUS.DEPRECATED);
    assert.ok(INSTALL_STATUS.UNAVAILABLE);
    assert.ok(INSTALL_STATUS.REQUIRES_MANUAL);
    assert.ok(INSTALL_STATUS.REQUIRES_LOGIN);
    assert.ok(INSTALL_STATUS.UNSUPPORTED);
    assert.ok(INSTALL_STATUS.UNTESTED);
});

test("FAILURE_REASONS has all required reasons", () => {
    assert.ok(FAILURE_REASONS.PACKAGE_NOT_FOUND);
    assert.ok(FAILURE_REASONS.PACKAGE_RENAMED);
    assert.ok(FAILURE_REASONS.TAP_REQUIRED);
    assert.ok(FAILURE_REASONS.PACKAGE_MANAGER_MISSING);
    assert.ok(FAILURE_REASONS.DEPENDENCY_MISSING);
    assert.ok(FAILURE_REASONS.UNSUPPORTED_ARCH);
    assert.ok(FAILURE_REASONS.UNSUPPORTED_OS);
    assert.ok(FAILURE_REASONS.REQUIRES_AUTH);
    assert.ok(FAILURE_REASONS.INTERACTIVE_INSTALLER);
    assert.ok(FAILURE_REASONS.INSTALL_TIMEOUT);
    assert.ok(FAILURE_REASONS.ALREADY_INSTALLED);
    assert.ok(FAILURE_REASONS.NETWORK_ERROR);
    assert.ok(FAILURE_REASONS.PERMISSION_DENIED);
    assert.ok(FAILURE_REASONS.DISK_SPACE);
    assert.ok(FAILURE_REASONS.UNKNOWN);
});

// ─── diagnoseFailure ──────────────────────────────────────────────────

test("diagnoseFailure detects Homebrew formula not found", () => {
    const result = diagnoseFailure(
        "brew install nonexistent-foo",
        "Error: No available formula with the name 'nonexistent-foo'",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.PACKAGE_NOT_FOUND);
    assert.equal(result.category, "brew");
    assert.ok(result.suggestedFix.includes("nonexistent-foo"));
});

test("diagnoseFailure detects Homebrew already installed", () => {
    const result = diagnoseFailure(
        "brew install node",
        "Warning: node-22.0.0 already installed",
        0
    );
    // Even though exit code is 0, the pattern matches
    assert.equal(result.reason, FAILURE_REASONS.ALREADY_INSTALLED);
});

test("diagnoseFailure detects npm 404", () => {
    const result = diagnoseFailure(
        "npm install -g nonexistent-pkg",
        "npm ERR! code E404\nnpm ERR! 404 Not Found",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.PACKAGE_NOT_FOUND);
    assert.equal(result.category, "npm");
});

test("diagnoseFailure detects npm peer dependency conflict", () => {
    const result = diagnoseFailure(
        "npm install -g some-pkg",
        "npm ERR! ERESOLVE could not resolve peer dep",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.DEPENDENCY_MISSING);
});

test("diagnoseFailure detects npm requires auth", () => {
    const result = diagnoseFailure(
        "npm install -g private-pkg",
        "npm ERR! ENEEDAUTH authentication required",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.REQUIRES_AUTH);
});

test("diagnoseFailure detects pip package not found", () => {
    const result = diagnoseFailure(
        "pip install nonexistent-pkg",
        "ERROR: No matching distribution found for nonexistent-pkg",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.PACKAGE_NOT_FOUND);
    assert.equal(result.category, "pip");
});

test("diagnoseFailure detects cargo package not found", () => {
    const result = diagnoseFailure(
        "cargo install nonexistent-crate",
        "error: could not find nonexistent-crate in registry",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.PACKAGE_NOT_FOUND);
    assert.equal(result.category, "cargo");
});

test("diagnoseFailure detects command not found (brew)", () => {
    const result = diagnoseFailure(
        "brew install node",
        "zsh: command not found: brew",
        127
    );
    assert.equal(result.reason, FAILURE_REASONS.PACKAGE_MANAGER_MISSING);
    assert.ok(result.suggestedFix.includes("Homebrew"));
});

test("diagnoseFailure detects command not found (npm)", () => {
    const result = diagnoseFailure(
        "npm install -g foo",
        "zsh: command not found: npm",
        127
    );
    assert.equal(result.reason, FAILURE_REASONS.PACKAGE_MANAGER_MISSING);
    assert.ok(result.suggestedFix.includes("npm"));
});

test("diagnoseFailure detects unsupported architecture", () => {
    const result = diagnoseFailure(
        "brew install some-pkg",
        "Error: some-pkg: unsupported architecture arm64",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.UNSUPPORTED_ARCH);
});

test("diagnoseFailure detects permission denied", () => {
    const result = diagnoseFailure(
        "npm install -g foo",
        "npm ERR! EACCES permission denied",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.PERMISSION_DENIED);
});

test("diagnoseFailure detects network error", () => {
    const result = diagnoseFailure(
        "brew install foo",
        "curl: (6) Could not resolve host: formulae.brew.sh",
        1
    );
    assert.equal(result.reason, FAILURE_REASONS.NETWORK_ERROR);
});

test("diagnoseFailure detects timeout", () => {
    const result = diagnoseFailure(
        "brew install foo",
        "",
        1,
        true
    );
    assert.equal(result.reason, FAILURE_REASONS.INSTALL_TIMEOUT);
});

test("diagnoseFailure returns UNKNOWN for unrecognized errors", () => {
    const result = diagnoseFailure(
        "some-command",
        "Some weird error that doesn't match any pattern",
        42
    );
    assert.equal(result.reason, FAILURE_REASONS.UNKNOWN);
    assert.ok(result.message.includes("42"));
});

test("diagnoseFailure always provides a suggestedFix", () => {
    const result = diagnoseFailure("cmd", "weird error", 1);
    assert.ok(typeof result.suggestedFix === "string");
    assert.ok(result.suggestedFix.length > 0);
});

test("diagnoseFailure always provides a message", () => {
    const result = diagnoseFailure("cmd", "weird error", 1);
    assert.ok(typeof result.message === "string");
    assert.ok(result.message.length > 0);
});

// ─── buildVerificationSummary ─────────────────────────────────────────

test("buildVerificationSummary counts statuses correctly", () => {
    const results = [
        { name: "a", status: INSTALL_STATUS.VERIFIED },
        { name: "b", status: INSTALL_STATUS.VERIFIED },
        { name: "c", status: INSTALL_STATUS.BROKEN_REGISTRY_METADATA },
        { name: "d", status: INSTALL_STATUS.REMOVED_BY_VENDOR },
        { name: "e", status: INSTALL_STATUS.UNSUPPORTED_PLATFORM },
        { name: "f", status: INSTALL_STATUS.MANUAL_INSTALLATION },
        { name: "g", status: INSTALL_STATUS.AUTHENTICATION_REQUIRED },
        { name: "h", status: INSTALL_STATUS.UNTESTED }
    ];
    const summary = buildVerificationSummary(results);
    assert.equal(summary.total, 8);
    assert.equal(summary.verified, 2);
    assert.equal(summary.brokenRegistryMetadata, 1);
    assert.equal(summary.removedByVendor, 1);
    assert.equal(summary.unsupportedPlatform, 1);
    assert.equal(summary.manualInstallation, 1);
    assert.equal(summary.authenticationRequired, 1);
    assert.equal(summary.untested, 1);
});

test("buildVerificationSummary calculates success rate", () => {
    const results = [
        { name: "a", status: INSTALL_STATUS.VERIFIED },
        { name: "b", status: INSTALL_STATUS.VERIFIED },
        { name: "c", status: INSTALL_STATUS.BROKEN }
    ];
    const summary = buildVerificationSummary(results);
    assert.equal(summary.successRate, 66.7);
});

test("buildVerificationSummary handles empty results", () => {
    const summary = buildVerificationSummary([]);
    assert.equal(summary.total, 0);
    assert.equal(summary.successRate, 0);
});

test("buildVerificationSummary 100% success rate", () => {
    const results = [
        { name: "a", status: INSTALL_STATUS.VERIFIED },
        { name: "b", status: INSTALL_STATUS.VERIFIED }
    ];
    const summary = buildVerificationSummary(results);
    assert.equal(summary.successRate, 100);
});

// ─── logInstallation / readInstallLog ─────────────────────────────────

test("logInstallation writes a log file", () => {
    withTempHome(() => {
        const result = {
            name: "test-pkg",
            success: true,
            exitCode: 0,
            stdout: "installed",
            stderr: "",
            command: "brew install test-pkg",
            installer: "brew-formula",
            elapsedMs: 5000,
            timedOut: false,
            timestamp: new Date().toISOString()
        };
        logInstallation("test-pkg", result);
        const log = readInstallLog("test-pkg");
        assert.equal(log.length, 1);
        assert.equal(log[0].command, "brew install test-pkg");
        assert.equal(log[0].result, "success");
    });
});

test("logInstallation appends to existing log", () => {
    withTempHome(() => {
        const result1 = { name: "pkg", success: true, exitCode: 0, stdout: "", stderr: "", command: "cmd1", installer: "brew", elapsedMs: 100, timedOut: false, timestamp: "2025-01-01T00:00:00Z" };
        const result2 = { name: "pkg", success: false, exitCode: 1, stdout: "", stderr: "error", command: "cmd2", installer: "brew", elapsedMs: 200, timedOut: false, timestamp: "2025-01-02T00:00:00Z" };
        logInstallation("pkg", result1);
        logInstallation("pkg", result2);
        const log = readInstallLog("pkg");
        assert.equal(log.length, 2);
        assert.equal(log[0].command, "cmd1");
        assert.equal(log[1].command, "cmd2");
    });
});

test("logInstallation keeps only last 10 entries", () => {
    withTempHome(() => {
        for (let i = 0; i < 15; i++) {
            logInstallation("pkg", {
                name: "pkg", success: true, exitCode: 0, stdout: "", stderr: "",
                command: `cmd${i}`, installer: "brew", elapsedMs: 100, timedOut: false,
                timestamp: new Date().toISOString()
            });
        }
        const log = readInstallLog("pkg");
        assert.equal(log.length, 10);
        assert.equal(log[0].command, "cmd5");
        assert.equal(log[9].command, "cmd14");
    });
});

test("logInstallation logs failure with reason", () => {
    withTempHome(() => {
        const result = {
            name: "broken-pkg",
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: "Error: No available formula",
            command: "brew install broken-pkg",
            installer: "brew-formula",
            elapsedMs: 1000,
            timedOut: false,
            timestamp: new Date().toISOString(),
            failureReason: FAILURE_REASONS.PACKAGE_NOT_FOUND,
            failureMessage: "Formula does not exist.",
            suggestedFix: "Search for alternatives"
        };
        logInstallation("broken-pkg", result);
        const log = readInstallLog("broken-pkg");
        assert.equal(log[0].result, "failed");
        assert.equal(log[0].failureReason, FAILURE_REASONS.PACKAGE_NOT_FOUND);
        assert.ok(log[0].suggestedFix);
    });
});

test("readInstallLog returns empty for non-existent package", () => {
    withTempHome(() => {
        const log = readInstallLog("nonexistent");
        assert.deepEqual(log, []);
    });
});

// ─── Verification status tracking ─────────────────────────────────────

test("updateVerificationStatus writes and reads back", () => {
    withTempHome(() => {
        updateVerificationStatus("test-pkg", INSTALL_STATUS.VERIFIED, "2025-01-01T00:00:00Z");
        const ver = getVerificationStatus("test-pkg");
        assert.equal(ver.status, INSTALL_STATUS.VERIFIED);
        assert.equal(ver.verifiedAt, "2025-01-01T00:00:00Z");
    });
});

test("getVerificationStatus returns UNTESTED for unknown package", () => {
    withTempHome(() => {
        const ver = getVerificationStatus("unknown-pkg");
        assert.equal(ver.status, INSTALL_STATUS.UNTESTED);
        assert.equal(ver.verifiedAt, null);
    });
});

test("loadVerificationStatuses returns empty when no file exists", () => {
    withTempHome(() => {
        const all = loadVerificationStatuses();
        assert.deepEqual(all, {});
    });
});

test("updateVerificationStatus persists failure info", () => {
    withTempHome(() => {
        updateVerificationStatus(
            "broken-pkg",
            INSTALL_STATUS.BROKEN,
            "2025-01-01T00:00:00Z",
            FAILURE_REASONS.PACKAGE_NOT_FOUND,
            "Formula does not exist"
        );
        const ver = getVerificationStatus("broken-pkg");
        assert.equal(ver.status, INSTALL_STATUS.BROKEN);
        assert.equal(ver.failureReason, FAILURE_REASONS.PACKAGE_NOT_FOUND);
        assert.equal(ver.failureMessage, "Formula does not exist");
    });
});

// ─── registryDoctor ───────────────────────────────────────────────────

test("registryDoctor detects missing validate commands", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-no-validate", category: "test", install: { method: "brew-formula", id: "foo" } }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "missing_validate" && i.package === "pkg-no-validate"));
    });
});

test("registryDoctor detects missing install commands", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-no-install", category: "test", validate: "foo --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "missing_install" && i.package === "pkg-no-install"));
    });
});

test("registryDoctor detects missing update commands", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-no-update", category: "test", install: { method: "brew-formula", id: "foo" }, validate: "foo --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "missing_update" && i.package === "pkg-no-update"));
    });
});

test("registryDoctor detects missing uninstall commands", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-no-uninstall", category: "test", install: { method: "brew-formula", id: "foo" }, validate: "foo --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "missing_uninstall" && i.package === "pkg-no-uninstall"));
    });
});

test("registryDoctor detects duplicate aliases", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-a", category: "test", aliases: ["foo"], install: { method: "brew-formula", id: "a" }, validate: "a --version" },
            { name: "pkg-b", category: "test", aliases: ["foo"], install: { method: "brew-formula", id: "b" }, validate: "b --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "duplicate_alias" && i.package === "pkg-b"));
    });
});

test("registryDoctor detects deprecated packages", () => {
    withTempHome(() => {
        const packages = [
            { name: "old-pkg", category: "test", stability: "deprecated", install: { method: "brew-formula", id: "old" }, validate: "old --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "deprecated" && i.package === "old-pkg"));
    });
});

test("registryDoctor detects never-tested packages", () => {
    withTempHome(() => {
        const packages = [
            { name: "untested-pkg", category: "test", install: { method: "brew-formula", id: "foo" }, validate: "foo --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "never_tested" && i.package === "untested-pkg"));
    });
});

test("registryDoctor detects broken packages from verification status", () => {
    withTempHome(() => {
        updateVerificationStatus("broken-pkg", INSTALL_STATUS.BROKEN_REGISTRY_METADATA, "2025-01-01", FAILURE_REASONS.PACKAGE_NOT_FOUND, "Formula not found");
        const packages = [
            { name: "broken-pkg", category: "test", install: { method: "brew-formula", id: "broken" }, validate: "broken --version" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "broken_metadata" && i.package === "broken-pkg"));
    });
});

test("registryDoctor returns summary with correct counts", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-a", category: "test", install: { method: "brew-formula", id: "a" }, validate: "a --version", update: "brew upgrade a", uninstall: { method: "brew-formula", id: "a" }, homepage: "https://a.com", repository: "https://github.com/a" },
            { name: "pkg-b", category: "test", install: { method: "brew-formula", id: "b" } }
        ];
        const { summary } = registryDoctor({ packages });
        assert.equal(summary.total, 2);
        assert.ok(summary.issues > 0);
        assert.ok(summary.errors >= 0);
        assert.ok(summary.warnings >= 0);
    });
});

test("registryDoctor with complete packages has fewer issues", () => {
    withTempHome(() => {
        const packages = [
            {
                name: "complete-pkg",
                category: "test",
                platforms: ["macos", "linux"],
                architectures: ["intel", "apple-silicon"],
                documentation: "https://docs.complete.com",
                install: { method: "brew-formula", id: "complete" },
                validate: "complete --version",
                update: "brew upgrade complete",
                uninstall: { method: "brew-formula", id: "complete" },
                homepage: "https://complete.com",
                repository: "https://github.com/complete",
                aliases: []
            }
        ];
        const { issues } = registryDoctor({ packages });
        // Should still have never_tested but no missing_* issues
        assert.ok(!issues.some((i) => i.type.startsWith("missing_")));
    });
});

// ─── Integration: real registry ───────────────────────────────────────

test("registryDoctor with real registry finds issues", () => {
    withTempHome(() => {
        const { issues, summary } = registryDoctor({});
        assert.ok(summary.total > 0);
        // Real registry should have some issues (missing update/uninstall etc.)
        assert.ok(issues.length > 0);
    });
});

// ─── v2: Responsibility & STATUS_META ──────────────────────────────────

test("RESPONSIBILITY has all classifications", () => {
    assert.ok(RESPONSIBILITY.USER);
    assert.ok(RESPONSIBILITY.VENDOR);
    assert.ok(RESPONSIBILITY.DEVFORGEKIT);
    assert.ok(RESPONSIBILITY.NONE);
});

test("STATUS_META covers all INSTALL_STATUS values", () => {
    const statusValues = new Set(Object.values(INSTALL_STATUS));
    for (const status of statusValues) {
        assert.ok(STATUS_META[status], `STATUS_META missing entry for status: ${status}`);
        assert.ok(typeof STATUS_META[status].icon === "string");
        assert.ok(typeof STATUS_META[status].label === "string");
        assert.ok(typeof STATUS_META[status].description === "string");
        assert.ok(STATUS_META[status].responsibility !== undefined);
    }
});

test("diagnoseFailure returns responsibility classification", () => {
    const result = diagnoseFailure("brew install foo", "Error: No available formula", 1, false);
    assert.equal(result.responsibility, RESPONSIBILITY.VENDOR);
    assert.equal(result.canDevForgeKitFix, false);
    assert.equal(result.canUserFix, false);
});

test("diagnoseFailure returns DEVFORGEKIT responsibility for broken download", () => {
    const result = diagnoseFailure("curl -L https://example.com/download", "curl: (22) The requested URL returned error: 404", 1, false);
    assert.equal(result.responsibility, RESPONSIBILITY.DEVFORGEKIT);
    assert.equal(result.canDevForgeKitFix, true);
});

test("diagnoseFailure returns USER responsibility for command not found", () => {
    const result = diagnoseFailure("brew install foo", "zsh: command not found: brew", 127, false);
    assert.equal(result.responsibility, RESPONSIBILITY.USER);
    assert.equal(result.canUserFix, true);
});

// ─── v2: Platform detection ────────────────────────────────────────────

test("detectPlatformSync returns current OS and CPU", () => {
    const plat = detectPlatformSync();
    assert.ok(plat.os);
    assert.ok(plat.cpu);
    assert.ok(plat.arch);
    assert.ok(plat.platform);
});

test("checkPlatformSupport returns null for no metadata", () => {
    const pkg = { name: "test" };
    const result = checkPlatformSupport(pkg);
    assert.equal(result.supported, null);
});

test("checkPlatformSupport returns true when current OS is listed", () => {
    const current = detectPlatformSync();
    const pkg = { name: "test", platforms: [current.os] };
    const result = checkPlatformSupport(pkg);
    assert.equal(result.supported, true);
});

test("checkPlatformSupport returns false when current OS is not listed", () => {
    const pkg = { name: "test", platforms: ["windows"] };
    const result = checkPlatformSupport(pkg);
    assert.equal(result.supported, false);
    assert.ok(result.reason.includes("windows"));
});

test("checkArchitectureSupport returns null for no metadata", () => {
    const pkg = { name: "test" };
    const result = checkArchitectureSupport(pkg);
    assert.equal(result.supported, null);
});

// ─── v2: mapFailureToStatus ────────────────────────────────────────────

test("mapFailureToStatus maps package not found to REMOVED_BY_VENDOR", () => {
    assert.equal(mapFailureToStatus(FAILURE_REASONS.PACKAGE_NOT_FOUND), INSTALL_STATUS.REMOVED_BY_VENDOR);
});

test("mapFailureToStatus maps unsupported arch to UNSUPPORTED_ARCHITECTURE", () => {
    assert.equal(mapFailureToStatus(FAILURE_REASONS.UNSUPPORTED_ARCH), INSTALL_STATUS.UNSUPPORTED_ARCHITECTURE);
});

test("mapFailureToStatus maps package manager missing", () => {
    assert.equal(mapFailureToStatus(FAILURE_REASONS.PACKAGE_MANAGER_MISSING), INSTALL_STATUS.MISSING_PACKAGE_MANAGER);
});

test("mapFailureToStatus maps network error", () => {
    assert.equal(mapFailureToStatus(FAILURE_REASONS.NETWORK_ERROR), INSTALL_STATUS.NETWORK_ERROR);
});

test("mapFailureToStatus maps broken download", () => {
    assert.equal(mapFailureToStatus(FAILURE_REASONS.BROKEN_DOWNLOAD), INSTALL_STATUS.BROKEN_DOWNLOAD);
});

// ─── v2: getPackageDiagnostics ─────────────────────────────────────────

test("getPackageDiagnostics returns full diagnostics object", () => {
    withTempHome(() => {
        const pkg = {
            name: "test-pkg",
            category: "test",
            platforms: ["macos", "linux"],
            homepage: "https://test.com",
            documentation: "https://docs.test.com",
            recommendedAlternatives: ["other-pkg"],
            install: { method: "brew-formula", id: "test" },
            validate: "test --version"
        };
        const allPackages = [pkg, { name: "other-pkg", category: "test", stability: "stable" }];
        const diag = getPackageDiagnostics(pkg, allPackages);
        assert.equal(diag.package, "test-pkg");
        assert.ok(diag.statusIcon);
        assert.ok(diag.statusLabel);
        assert.ok(diag.responsibility !== undefined);
        assert.ok(diag.platformSupport);
        assert.ok(diag.architectureSupport);
        assert.ok(diag.why);
        assert.ok(Array.isArray(diag.alternatives));
        assert.ok(diag.alternatives.includes("other-pkg"));
    });
});

// ─── v2: formatInstallFailure ──────────────────────────────────────────

test("formatInstallFailure produces rich output", () => {
    const installResult = {
        command: "brew install nonexistent",
        stderr: "Error: No available formula",
        exitCode: 1,
        timedOut: false
    };
    const pkg = {
        name: "nonexistent",
        category: "test",
        platforms: ["macos"],
        homepage: "https://example.com",
        recommendedAlternatives: ["alternative-pkg"]
    };
    const output = formatInstallFailure(installResult, pkg, [pkg, { name: "alternative-pkg", category: "test" }]);
    assert.ok(output.includes("Installation Failed"));
    assert.ok(output.includes("Package:"));
    assert.ok(output.includes("Status:"));
    assert.ok(output.includes("Reason:"));
    assert.ok(output.includes("Responsible:"));
    assert.ok(output.includes("Suggested Fix:"));
    assert.ok(output.includes("Alternatives:"));
});

// ─── v2: registryDoctor quality score ──────────────────────────────────

test("registryDoctor returns quality score", () => {
    withTempHome(() => {
        const packages = [
            { name: "good-pkg", category: "test", platforms: ["macos"], architectures: ["intel"], documentation: "https://docs.com", install: { method: "brew-formula", id: "good" }, validate: "good --version", update: "brew upgrade good", uninstall: { method: "brew-formula", id: "good" }, homepage: "https://good.com", repository: "https://github.com/good" }
        ];
        const { summary } = registryDoctor({ packages });
        assert.ok(typeof summary.qualityScore === "number");
        assert.ok(summary.qualityScore >= 0 && summary.qualityScore <= 100);
    });
});

test("registryDoctor detects missing platform metadata", () => {
    withTempHome(() => {
        const packages = [
            { name: "no-platform", category: "test", install: { method: "brew-formula", id: "np" }, validate: "np --version", update: "brew upgrade np", uninstall: { method: "brew-formula", id: "np" }, homepage: "https://np.com", repository: "https://github.com/np" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "missing_platform_metadata" && i.package === "no-platform"));
    });
});

test("registryDoctor detects deprecated without replacement", () => {
    withTempHome(() => {
        const packages = [
            { name: "deprecated-pkg", category: "test", stability: "deprecated", platforms: ["macos"], architectures: ["intel"], documentation: "https://docs.com", install: { method: "brew-formula", id: "dep" }, validate: "dep --version", update: "brew upgrade dep", uninstall: { method: "brew-formula", id: "dep" }, homepage: "https://dep.com", repository: "https://github.com/dep" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "deprecated_without_replacement" && i.package === "deprecated-pkg"));
    });
});

test("registryDoctor detects broken dependencies", () => {
    withTempHome(() => {
        const packages = [
            { name: "pkg-with-bad-dep", category: "test", dependencies: ["nonexistent-dep"], platforms: ["macos"], architectures: ["intel"], documentation: "https://docs.com", install: { method: "brew-formula", id: "pwd" }, validate: "pwd --version", update: "brew upgrade pwd", uninstall: { method: "brew-formula", id: "pwd" }, homepage: "https://pwd.com", repository: "https://github.com/pwd" }
        ];
        const { issues } = registryDoctor({ packages });
        assert.ok(issues.some((i) => i.type === "broken_dependency" && i.package === "pkg-with-bad-dep"));
    });
});

// ─── Regression: registry verify must be read-only by default ─────────
//
// Real bug found and fixed: `devforgekit registry verify` used to
// unconditionally attempt a real package-manager install
// (installWithDetails) for every registry package not already
// installed - despite "verify" being exactly the kind of name every
// other read-only command in this CLI (audit/check/doctor/lint/stats/
// list/...) is held to never do. It was run by accident against a real
// development machine before this was caught. verifyPackage/
// verifyAllPackages must now default to attemptInstall: false and only
// ever run the real install command when the caller explicitly opts in.
//
// A synthetic package's "install" step writes a canary file - if the
// canary never appears, the install command was never executed. This
// directly observes the actual side effect (or absence of one) rather
// than just asserting a returned status string, so it would have caught
// the original bug even if the status/label text had looked plausible.
test("verifyPackage never attempts a real install by default (attemptInstall omitted) - proven by a canary file that must never appear", async () => {
    await withTempHomeAsync(async (tempHome) => {
        const canaryFile = path.join(tempHome, "install-was-attempted.canary");
        const pkg = {
            name: "never-installed-test-pkg",
            category: "utilities",
            validate: "false", // always exits non-zero -> never "already installed"
            install: { method: "shell", command: `touch ${canaryFile}` }
        };

        const result = await verifyPackage(pkg, {});

        assert.equal(result.status, INSTALL_STATUS.NOT_INSTALLED);
        assert.equal(result.success, false);
        const { existsSync } = await import("node:fs");
        assert.equal(existsSync(canaryFile), false, "verifyPackage must never run the install command unless attemptInstall: true is explicitly passed");
    });
});

test("verifyPackage still genuinely attempts a real install when attemptInstall: true is explicitly passed (proves the canary methodology itself works)", async () => {
    await withTempHomeAsync(async (tempHome) => {
        const canaryFile = path.join(tempHome, "install-was-attempted.canary");
        const pkg = {
            name: "never-installed-test-pkg-2",
            category: "utilities",
            validate: "false",
            install: { method: "shell", command: `touch ${canaryFile}` }
        };

        await verifyPackage(pkg, { attemptInstall: true });

        const { existsSync } = await import("node:fs");
        assert.equal(existsSync(canaryFile), true, "with attemptInstall: true, the real install command must actually run");
    });
});

test("verifyAllPackages defaults to attemptInstall: false and reports notInstalled in the summary, not a false failure/success status", async () => {
    await withTempHomeAsync(async (tempHome) => {
        const canaryFile = path.join(tempHome, "install-was-attempted-all.canary");
        const packages = [
            { name: "never-installed-a", category: "utilities", validate: "false", install: { method: "shell", command: `touch ${canaryFile}` } },
            { name: "never-installed-b", category: "utilities", validate: "false", install: { method: "shell", command: "true" } }
        ];

        const { results, summary } = await verifyAllPackages({ packages });

        const { existsSync } = await import("node:fs");
        assert.equal(existsSync(canaryFile), false, "verifyAllPackages must never install anything by default");
        assert.equal(summary.notInstalled, 2);
        assert.ok(results.every((r) => r.status === INSTALL_STATUS.NOT_INSTALLED));
    });
});
