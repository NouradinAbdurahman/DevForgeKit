// Regression tests for the macOS Keychain credential backend's fix for a
// real shell-injection vulnerability: set()/get()/remove()/exists() used
// to build a single `security ...` string via unescaped double-quote
// interpolation of the provider id and API key, executed with execSync
// (always shell-interpreted). A pasted key containing `"` followed by
// shell metacharacters could break out and run arbitrary commands. The
// fix switches those four operations to execFileSync with an argv array
// - no shell is ever invoked, so there is nothing to break out of.
//
// Per ai-credential-backend.test.js's standing rule, no automated test
// may touch the real macOS Keychain - every test here injects fake
// execFileImpl/execImpl functions (the same fetchImpl-style dependency
// injection the AI provider clients use) instead of letting the class
// fall back to the real node:child_process functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { KeychainBackend, KeychainUnavailableError } from "../src/core/ai/credentials/backends/keychain.js";

function fakeExecImpl() {
    // Every detectKeychain() precondition probe succeeds.
    return "";
}

test("set() passes the API key as a literal argv element, never interpolated into a shell string", () => {
    const calls = [];
    const backend = new KeychainBackend({
        execImpl: fakeExecImpl,
        platform: "darwin",
        execFileImpl: (file, args) => {
            calls.push({ file, args });
            return "";
        }
    });

    const maliciousKey = `sk-real" ; touch /tmp/pwned ; echo "`;
    backend.set("openai", maliciousKey);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, "security");
    // The malicious payload must appear as one whole, untouched argv
    // element - proof it was never concatenated into a shell command
    // string that a shell would re-parse.
    assert.ok(calls[0].args.includes(maliciousKey));
    // And no argv element should ever contain a shell command
    // substitution/separator that got there by splitting the payload.
    for (const arg of calls[0].args) {
        if (arg !== maliciousKey) {
            assert.ok(!arg.includes("touch /tmp/pwned"));
        }
    }
});

test("get()/remove()/exists() pass the provider id as a literal argv element", () => {
    const calls = [];
    const execFileImpl = (file, args) => {
        calls.push({ file, args });
        return "stored-value\n";
    };
    const backend = new KeychainBackend({ execImpl: fakeExecImpl, platform: "darwin", execFileImpl });

    const maliciousProvider = `openai" ; rm -rf ~ ; echo "`;
    backend.get(maliciousProvider);
    backend.remove(maliciousProvider);
    backend.exists(maliciousProvider);

    assert.equal(calls.length, 3);
    for (const call of calls) {
        assert.equal(call.file, "security");
        assert.ok(call.args.includes(maliciousProvider));
        for (const arg of call.args) {
            if (arg !== maliciousProvider) assert.ok(!arg.includes("rm -rf"));
        }
    }
});

test("set() never calls execImpl (the shell-interpreted path) - only execFileImpl", () => {
    let shellCalls = 0;
    const backend = new KeychainBackend({
        execImpl: (...args) => {
            shellCalls++;
            return fakeExecImpl(...args);
        },
        platform: "darwin",
        execFileImpl: () => ""
    });
    // detectKeychain() legitimately uses execImpl (no user data involved -
    // only fixed diagnostic commands), so reset the counter after
    // construction and verify set() itself adds no further shell calls.
    shellCalls = 0;
    backend.set("openai", "sk-value");
    assert.equal(shellCalls, 0);
});

test("set() throws KeychainUnavailableError (not a raw exec error) when the write fails", () => {
    const backend = new KeychainBackend({
        execImpl: fakeExecImpl,
        platform: "darwin",
        execFileImpl: () => {
            throw new Error("keychain locked");
        }
    });
    assert.throws(() => backend.set("openai", "sk-value"), KeychainUnavailableError);
});

test("detectKeychain probes use the injected execImpl, not the real security binary", () => {
    const probes = [];
    const backend = new KeychainBackend({
        execImpl: (cmd) => {
            probes.push(cmd);
            return "";
        },
        platform: "darwin",
        execFileImpl: () => ""
    });
    assert.equal(backend._available, true);
    assert.equal(probes.length, 3);
});

test("on a non-macOS platform, detectKeychain reports unavailable without ever calling execImpl", () => {
    let calls = 0;
    const backend = new KeychainBackend({
        execImpl: () => {
            calls++;
            return "";
        },
        platform: "linux",
        execFileImpl: () => ""
    });
    assert.equal(backend._available, false);
    assert.equal(backend._reason, "not macOS");
    assert.equal(calls, 0);
});
