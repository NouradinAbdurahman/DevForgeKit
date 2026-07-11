// macOS Keychain credential backend: stores API keys in the macOS
// Keychain via the `security` CLI. Before any operation, verifies that
// the keychain is actually available (security binary exists, default
// keychain exists, keychain is unlocked). Returns structured errors
// instead of launching GUI dialogs.
//
// This backend is only selected on macOS in production (not test, not
// CI). It never runs during `npm test`.
import { execSync, execFileSync } from "node:child_process";
import { CredentialBackend } from "../backend.js";

const SERVICE = "DevForgeKit";

// KeychainUnavailableError: structured error for when the keychain
// cannot be used. Never triggers a GUI dialog.
export class KeychainUnavailableError extends Error {
    constructor(reason) {
        super(`Keychain unavailable: ${reason}`);
        this.name = "KeychainUnavailableError";
        this.reason = reason;
    }
}

// detectKeychain() -> { available, reason? }. Checks all preconditions
// before attempting any keychain operation. This is the gate that
// prevents GUI dialogs — if any check fails, we return an error instead
// of letting `security` prompt the user.
function detectKeychain(execImpl, platform = process.platform) {
    // 1. Must be macOS
    if (platform !== "darwin") {
        return { available: false, reason: "not macOS" };
    }

    // 2. `security` binary must exist
    try {
        execImpl("which security 2>/dev/null", { stdio: "pipe", encoding: "utf8" });
    } catch {
        return { available: false, reason: "security binary not found" };
    }

    // 3. Default keychain must exist
    try {
        execImpl("security default-keychain 2>/dev/null", { stdio: "pipe", encoding: "utf8" });
    } catch {
        return { available: false, reason: "no default keychain" };
    }

    // 4. Keychain must be unlocked (check by listing without a prompt)
    try {
        execImpl("security show-keychain-info 2>/dev/null", { stdio: "pipe" });
    } catch {
        return { available: false, reason: "keychain locked" };
    }

    return { available: true };
}

export class KeychainBackend extends CredentialBackend {
    // execFileImpl/execImpl are injectable the same way the AI provider
    // clients inject fetchImpl (see core/ai/providers/base.js) - lets
    // cli/test/ai-credential-keychain.test.js verify the exact argv every
    // operation shells out with (in particular, that a key/provider value
    // is always passed as a literal argv element and can never break out
    // of a shell string) without ever touching the real macOS Keychain,
    // which no automated test is allowed to do (see
    // ai-credential-backend.test.js). `platform` is injectable too and
    // defaults to the real process.platform - this repo's own CI only
    // runs Node tests on ubuntu-latest (see cli.yml), so without this
    // override the injection-safety regression tests above could never
    // actually execute in CI at all (detectKeychain's real "must be
    // macOS" gate would report unavailable and every set()/get()/
    // remove()/exists() call would throw before reaching the injected
    // exec functions) - forcing platform: "darwin" here tests the actual
    // security property (safe command construction) independently of
    // whether this specific host would really use this backend.
    constructor({ execFileImpl = execFileSync, execImpl = execSync, platform = process.platform } = {}) {
        super();
        this._execFile = execFileImpl;
        this._exec = execImpl;
        const detection = detectKeychain(this._exec, platform);
        this._available = detection.available;
        this._reason = detection.reason || null;
    }

    _ensureAvailable() {
        if (!this._available) {
            throw new KeychainUnavailableError(this._reason);
        }
    }

    set(provider, key) {
        this._ensureAvailable();
        try {
            this._execFile(
                "security",
                ["add-generic-password", "-a", provider, "-s", SERVICE, "-w", key, "-U"],
                { stdio: "pipe" }
            );
        } catch (err) {
            throw new KeychainUnavailableError(`write failed: ${err.message}`);
        }
    }

    get(provider) {
        if (!this._available) return null;
        try {
            const result = this._execFile(
                "security",
                ["find-generic-password", "-a", provider, "-s", SERVICE, "-w"],
                { stdio: "pipe", encoding: "utf8" }
            );
            return result.trim() || null;
        } catch {
            return null;
        }
    }

    remove(provider) {
        if (!this._available) return false;
        try {
            this._execFile(
                "security",
                ["delete-generic-password", "-a", provider, "-s", SERVICE],
                { stdio: "pipe" }
            );
            return true;
        } catch {
            return false;
        }
    }

    list() {
        if (!this._available) return [];
        try {
            const result = this._exec(
                `security dump-keychain 2>/dev/null | grep -A2 '"svce"<blob>="DevForgeKit"' | grep '"acct"<blob>=' | sed 's/.*"acct"<blob>="\\([^"]*\\)".*/\\1/'`,
                { stdio: "pipe", encoding: "utf8" }
            );
            const ids = new Set();
            for (const line of result.trim().split("\n")) {
                const id = line.trim();
                if (id) ids.add(id);
            }
            return [...ids].sort();
        } catch {
            return [];
        }
    }

    exists(provider) {
        if (!this._available) return false;
        try {
            this._execFile(
                "security",
                ["find-generic-password", "-a", provider, "-s", SERVICE],
                { stdio: "pipe" }
            );
            return true;
        } catch {
            return false;
        }
    }

    test() {
        if (!this._available) {
            return { ok: false, reason: this._reason };
        }
        try {
            this._exec("security show-keychain-info 2>/dev/null", { stdio: "pipe" });
            return { ok: true };
        } catch {
            return { ok: false, reason: "keychain locked or inaccessible" };
        }
    }

    location() {
        return "macOS Keychain";
    }
}
