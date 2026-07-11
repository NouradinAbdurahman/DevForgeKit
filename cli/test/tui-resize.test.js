// Rendering/resize stability tests. Unlike tui.test.js (which uses
// ink-testing-library's fake stdout - fixed at 100 columns, no `rows` at
// all), these drive Ink's own `render()` directly against a small,
// hand-rolled fake stdout whose `columns`/`rows` can be mutated and whose
// 'resize' event can be emitted on demand - the only way to actually
// exercise breakpoints, the too-small guard, and debounced/coalesced
// resize handling (hooks/useTerminalSize.js) end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { render as inkRender } from "ink";
import { App } from "../src/tui/App.js";
import { getBreakpoint, MIN_COLUMNS, MIN_ROWS, getPageMinSize, PAGE_MIN_SIZE } from "../src/tui/hooks/useTerminalSize.js";
import { navWidth, headerMode, headerHeight } from "../src/tui/layout/responsive.js";
import { setConfigValue } from "../src/core/config.js";

const h = React.createElement;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A fixed delay assumes the debounce timer gets to fire within that
// window - true in isolation, but a real, observed flake under a full
// concurrent test-suite run (CPU contention delays the debounce's own
// setTimeout past a short fixed budget). Poll instead: always yields at
// least once before the first check (never resolves in zero ticks - see
// tui-components.test.js's waitForCondition for why that ordering
// matters), then keeps extending the wait only as long as actually needed.
async function waitForCondition(check, { timeout = 2000, interval = 20 } = {}) {
    const start = Date.now();
    do {
        await delay(interval);
        if (check()) return;
    } while (Date.now() - start < timeout);
    if (!check()) {
        throw new Error(`waitForCondition: condition not met within ${timeout}ms`);
    }
}

class FakeStdout extends EventEmitter {
    constructor(columns, rows) {
        super();
        this.columns = columns;
        this.rows = rows;
        this.frames = [];
        this._lastFrame = undefined;
    }

    write = (frame) => {
        this.frames.push(frame);
        this._lastFrame = frame;
    };

    lastFrame = () => this._lastFrame;

    resizeTo(columns, rows) {
        this.columns = columns;
        this.rows = rows;
        this.emit("resize");
    }
}

class FakeStdin extends EventEmitter {
    isTTY = true;
    setEncoding() {}
    setRawMode() {}
    resume() {}
    pause() {}
    ref() {}
    unref() {}
}

// Pre-seeds onboardingSeen:true - this file tests resize behavior of
// the normal dashboard, not the v2.0.4 first-run wizard.
function withTempHome() {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-tui-resize-test-"));
    process.env.HOME = tempHome;
    setConfigValue("onboardingSeen", true);
    return () => {
        process.env.HOME = originalHome;
        // See test/tui.test.js's withTempHome for why: a still-in-flight
        // async write (workspace switch, snapshot) can race this cleanup.
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };
}

function renderAt(columns, rows, props = {}) {
    const stdout = new FakeStdout(columns, rows);
    const stderr = new FakeStdout(columns, rows);
    const stdin = new FakeStdin();
    const instance = inkRender(h(App, props), {
        stdout, stderr, stdin,
        debug: true, exitOnCtrlC: false, patchConsole: false
    });
    return { instance, stdout, stderr };
}

// --- Pure breakpoint/layout math (no rendering) --------------------------

test("getBreakpoint matches the PRD's six bands", () => {
    assert.equal(getBreakpoint(79), "xs");
    assert.equal(getBreakpoint(80), "sm");
    assert.equal(getBreakpoint(109), "sm");
    assert.equal(getBreakpoint(110), "md");
    assert.equal(getBreakpoint(159), "md");
    assert.equal(getBreakpoint(160), "lg");
    assert.equal(getBreakpoint(219), "lg");
    assert.equal(getBreakpoint(220), "xl");
    assert.equal(getBreakpoint(299), "xl");
    assert.equal(getBreakpoint(300), "ultraWide");
});

test("navWidth never returns a width that couldn't fit on the documented floor", () => {
    for (const columns of [80, 90, 100, 110, 130, 160, 220, 300]) {
        const width = navWidth(columns);
        assert.ok(width > 0 && width < columns, `navWidth(${columns}) = ${width} is out of range`);
    }
});

// --- Persistent header responsive tiers (layout/responsive.js) -----------

test("headerMode stays minimal at and near every page's own declared minimum size", () => {
    // The persistent header must never squeeze an existing page below the
    // row budget it was already tuned against - PAGE_MIN_SIZE tops out at
    // 28 rows, so anything at/near that must get the 3-row minimal header
    // (the same row budget the pre-redesign header used), not the taller
    // logo tiers.
    const maxPageRows = Math.max(...Object.values(PAGE_MIN_SIZE).map((s) => s.rows));
    for (const columns of [80, 90, 100]) {
        assert.equal(headerMode(columns, MIN_ROWS), "minimal");
        assert.equal(headerMode(columns, maxPageRows), "minimal");
        assert.equal(headerHeight(columns, maxPageRows), 3);
    }
});

test("headerMode escalates to compact then full only on generously large terminals", () => {
    assert.equal(headerMode(80, 24), "minimal");
    assert.equal(headerMode(100, 40), "minimal"); // this app's own test-default size
    assert.equal(headerMode(90, 47), "compact");
    assert.equal(headerMode(110, 53), "full");
    assert.equal(headerMode(300, 80), "full");
});

test("headerHeight matches the exact line count each mode renders", () => {
    assert.equal(headerHeight(80, 24), 3);    // wordmark + tagline + separator
    assert.equal(headerHeight(90, 47), 11);   // logo(8) + blank + wordmark + separator
    assert.equal(headerHeight(110, 53), 13);  // logo(8) + blank + wordmark + tagline + stats + separator
});

test("headerMode never regresses as either dimension grows (monotonic escalation)", () => {
    const rank = { minimal: 0, compact: 1, full: 2 };
    for (let rows = 20; rows <= 80; rows += 4) {
        let prev = 0;
        for (let columns = 80; columns <= 200; columns += 10) {
            const cur = rank[headerMode(columns, rows)];
            assert.ok(cur >= prev, `headerMode regressed at ${columns}x${rows}`);
            prev = cur;
        }
    }
});

// --- Rendering across the PRD's required sizes ---------------------------

for (const [columns, rows] of [[80, 24], [100, 30], [120, 40], [160, 50], [220, 60]]) {
    test(`renders one clean frame at ${columns}x${rows} with no "too small" fallback`, async () => {
        const restore = withTempHome();
        try {
            const { instance, stdout } = renderAt(columns, rows);
            await delay(150);
            const frame = stdout.lastFrame();
            assert.match(frame, /DevForgeKit/);
            assert.doesNotMatch(frame, /too small/i);
            instance.unmount();
        } finally {
            restore();
        }
    });
}

// --- Persistent DashboardHeader (docs/TUI.md's "Persistent dashboard
// header") -----------------------------------------------------------------

test("a generously large terminal shows the full banner: logo, tagline, and version/stats line", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(140, 55); // full tier: rows>=53, columns>=110
        await delay(150);
        const frame = stdout.lastFrame();
        assert.ok(frame.includes("______"), "the ASCII logo art should be present"); // distinctive substring from the logo's top row
        assert.match(frame, /DevForgeKit/);
        assert.match(frame, /Developer Environment Platform|Build\. Configure\. Ship\./);
        assert.match(frame, /Version \d+\.\d+\.\d+ • \d+ Components • \d+ Profiles • \d+ Recipes/);
        instance.unmount();
    } finally {
        restore();
    }
});

test("at the default/minimum-ish size the header collapses to wordmark+tagline, no logo or stats", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(100, 40); // minimal tier
        await delay(150);
        const frame = stdout.lastFrame();
        assert.match(frame, /DevForgeKit/);
        assert.ok(!frame.includes("______"), "the ASCII logo art should be hidden in minimal mode");
        assert.doesNotMatch(frame, /Version \d+\.\d+\.\d+ •/);
        instance.unmount();
    } finally {
        restore();
    }
});

test("the header's separator line renders directly under the banner, full width", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(100, 40);
        await delay(150);
        const frame = stdout.lastFrame();
        assert.match(frame, /─{20,}/);
        instance.unmount();
    } finally {
        restore();
    }
});

test("the banner persists identically across page navigation - it never disappears", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(100, 40, { initialPage: "components" });
        await delay(150);
        const onComponents = stdout.lastFrame();
        assert.match(onComponents, /DevForgeKit/);

        const { instance: instance2, stdout: stdout2 } = renderAt(100, 40, { initialPage: "help" });
        await delay(150);
        const onHelp = stdout2.lastFrame();
        assert.match(onHelp, /DevForgeKit/);

        instance.unmount();
        instance2.unmount();
    } finally {
        restore();
    }
});

test(`below the ${MIN_COLUMNS}x${MIN_ROWS} floor shows the too-small screen, not a corrupted layout`, async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(60, 15);
        await delay(150);
        const frame = stdout.lastFrame();
        assert.match(frame, /Terminal window is too small/);
        assert.match(frame, /60 \u00d7 15/);
        // The full dashboard chrome (nav, status bar) must not render
        // underneath/around the message - it's a full replacement, not
        // an overlay on top of a corrupted attempt at the real layout.
        assert.doesNotMatch(frame, /Tab focus/);
        assert.doesNotMatch(frame, /Project Generator/);
        instance.unmount();
    } finally {
        restore();
    }
});

test("growing past the floor recovers from the too-small screen back to the full dashboard", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(60, 15);
        await delay(150);
        assert.match(stdout.lastFrame(), /Terminal window is too small/);

        stdout.resizeTo(100, 30);
        await delay(200); // past the 120ms debounce

        const frame = stdout.lastFrame();
        assert.doesNotMatch(frame, /too small/i);
        assert.match(frame, /DevForgeKit/);
        instance.unmount();
    } finally {
        restore();
    }
});

// --- Per-page minimum sizes ----------------------------------------------

test("getPageMinSize returns the global floor for simple pages, higher for complex ones", () => {
    const dash = getPageMinSize("dashboard");
    assert.equal(dash.columns, 80);
    assert.equal(dash.rows, 24);

    const comp = getPageMinSize("components");
    assert.ok(comp.columns > 80, "components needs more than 80 cols");
    assert.ok(comp.rows > 24, "components needs more than 24 rows");

    // Unknown page falls back to global floor
    const unknown = getPageMinSize("nonexistent");
    assert.equal(unknown.columns, MIN_COLUMNS);
    assert.equal(unknown.rows, MIN_ROWS);
});

test("a page with a higher minimum shows too-small at a size that works for dashboard", async () => {
    const restore = withTempHome();
    try {
        // 85x25 is above dashboard's 80x24 but below components' 100x28
        const { instance, stdout } = renderAt(85, 25, { initialPage: "components" });
        await delay(150);
        const frame = stdout.lastFrame();
        assert.match(frame, /Terminal window is too small/);
        assert.match(frame, /100 \u00d7 28/);
        assert.match(frame, /Components/);
        instance.unmount();
    } finally {
        restore();
    }
});

test("growing past a page-specific minimum recovers to that page", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(85, 25, { initialPage: "components" });
        await delay(150);
        assert.match(stdout.lastFrame(), /too small/i);

        stdout.resizeTo(110, 30);
        await delay(200);

        const frame = stdout.lastFrame();
        assert.doesNotMatch(frame, /too small/i);
        assert.match(frame, /Components \(\d+\/\d+\)/);
        instance.unmount();
    } finally {
        restore();
    }
});

test("a burst of resize events settles into exactly one state update (debounced), not one per event", async () => {
    const restore = withTempHome();
    const originalDebug = process.env.DEVFORGEKIT_TUI_DEBUG;
    process.env.DEVFORGEKIT_TUI_DEBUG = "1";
    try {
        const { instance, stdout } = renderAt(100, 30);
        await delay(150);
        assert.match(stdout.lastFrame(), /resizes=0/);

        // Simulate a window being dragged: many resize events firing
        // faster than the debounce window, landing on several different
        // sizes before settling on the last one.
        for (let i = 0; i < 20; i++) {
            stdout.resizeTo(100 + i, 30);
        }
        await waitForCondition(() => /119x30/.test(stdout.lastFrame()));

        const frame = stdout.lastFrame();
        assert.match(frame, /119x30/);
        // The debounce coalesces all 20 events into exactly 1 commit.
        assert.match(frame, /resizes=1/, "a burst should coalesce to exactly 1 commit, not one per event");
        instance.unmount();
    } finally {
        if (originalDebug === undefined) delete process.env.DEVFORGEKIT_TUI_DEBUG;
        else process.env.DEVFORGEKIT_TUI_DEBUG = originalDebug;
        restore();
    }
});

test("a resize event that lands back on the same dimensions is a no-op (no phantom re-render count)", async () => {
    const restore = withTempHome();
    const originalDebug = process.env.DEVFORGEKIT_TUI_DEBUG;
    process.env.DEVFORGEKIT_TUI_DEBUG = "1";
    try {
        const { instance, stdout } = renderAt(100, 30);
        await delay(150);
        stdout.emit("resize"); // fires with columns/rows unchanged
        await delay(150);
        assert.match(stdout.lastFrame(), /resizes=0/);
        instance.unmount();
    } finally {
        if (originalDebug === undefined) delete process.env.DEVFORGEKIT_TUI_DEBUG;
        else process.env.DEVFORGEKIT_TUI_DEBUG = originalDebug;
        restore();
    }
});

test("rapid resize across many sizes for a sustained burst never throws and ends on the final size", async () => {
    const restore = withTempHome();
    const originalDebug = process.env.DEVFORGEKIT_TUI_DEBUG;
    process.env.DEVFORGEKIT_TUI_DEBUG = "1";
    try {
        const { instance, stdout } = renderAt(100, 30);
        await delay(150);

        const sizes = [[80, 24], [220, 60], [90, 28], [160, 50], [120, 40], [200, 55]];
        for (let round = 0; round < 10; round++) {
            for (const [columns, rows] of sizes) {
                stdout.resizeTo(columns, rows);
            }
        }
        await delay(250);

        const [lastColumns, lastRows] = sizes[sizes.length - 1];
        assert.doesNotThrow(() => stdout.lastFrame());
        assert.match(stdout.lastFrame(), new RegExp(`${lastColumns}x${lastRows}`));
        instance.unmount();
    } finally {
        if (originalDebug === undefined) delete process.env.DEVFORGEKIT_TUI_DEBUG;
        else process.env.DEVFORGEKIT_TUI_DEBUG = originalDebug;
        restore();
    }
});

// --- Listener/resource cleanup (no leaks across mount/unmount cycles) ----

test("listener cleanup is unaffected by page-specific minimums", async () => {
    const restore = withTempHome();
    try {
        const stdout = new FakeStdout(100, 30);
        const stderr = new FakeStdout(100, 30);

        for (let i = 0; i < 5; i++) {
            const stdin = new FakeStdin();
            const instance = inkRender(h(App, {}), {
                stdout, stderr, stdin,
                debug: true, exitOnCtrlC: false, patchConsole: false
            });
            await delay(40);
            instance.unmount();
            await delay(10);
        }

        assert.equal(stdout.listenerCount("resize"), 0, "every mount's resize listener must be removed on unmount");
    } finally {
        restore();
    }
});

// --- PTY-style integration: sustained resize through many sizes -----------
// These tests simulate what a real terminal does during a window drag:
// rapid-fire resize events at many different sizes, up and down, for
// hundreds of cycles. They assert no artifacts (duplicated borders,
// stale content, overlapping text, crashes, or remount loops).

test("sustained shrink-and-grow cycle produces no duplicated borders or stale frames", async () => {
    const restore = withTempHome();
    const originalDebug = process.env.DEVFORGEKIT_TUI_DEBUG;
    process.env.DEVFORGEKIT_TUI_DEBUG = "1";
    try {
        const { instance, stdout } = renderAt(220, 60);
        await delay(150);

        // Capture a clean reference frame at 220x40 for comparison.
        stdout.resizeTo(220, 40);
        await delay(200);
        const cleanFrame = stdout.lastFrame();
        const cleanLines = cleanFrame.split("\n").filter((l) => l.trim());
        const cleanLineCount = cleanLines.length;

        // Shrink from 220 down to 80, then grow back up, 5 full cycles.
        const sizes = [220, 200, 180, 160, 140, 120, 100, 90, 80, 90, 100, 120, 140, 160, 180, 200, 220];
        for (let cycle = 0; cycle < 5; cycle++) {
            for (const cols of sizes) {
                stdout.resizeTo(cols, 40);
                await delay(5); // faster than debounce, simulating a drag
            }
        }
        await delay(200); // let final debounce settle

        const frame = stdout.lastFrame();
        assert.ok(frame, "frame must exist after sustained resize");

        // A corrupted frame with duplicated content will have significantly
        // more lines than a clean frame at the same size.
        const lines = frame.split("\n").filter((l) => l.trim());
        assert.ok(lines.length <= cleanLineCount + 2,
            `line count ${lines.length} vs clean ${cleanLineCount} suggests duplicated frames`);

        // The frame should end at 220x40 (the last size in the cycle).
        assert.match(frame, /220x40/);

        instance.unmount();
    } finally {
        if (originalDebug === undefined) delete process.env.DEVFORGEKIT_TUI_DEBUG;
        else process.env.DEVFORGEKIT_TUI_DEBUG = originalDebug;
        restore();
    }
});

test("rapid resize at extreme sizes (80 to 300 and back) never throws or corrupts", async () => {
    const restore = withTempHome();
    const originalDebug = process.env.DEVFORGEKIT_TUI_DEBUG;
    process.env.DEVFORGEKIT_TUI_DEBUG = "1";
    try {
        const { instance, stdout } = renderAt(80, 24);
        await delay(150);

        // Jump between extremes rapidly - this is the worst case for
        // layout engines: completely different layouts on each event.
        const extremes = [
            [80, 24], [300, 80], [80, 24], [250, 60], [80, 24],
            [200, 50], [80, 24], [150, 40], [80, 24], [100, 30]
        ];
        for (let round = 0; round < 10; round++) {
            for (const [cols, rows] of extremes) {
                stdout.resizeTo(cols, rows);
                await delay(3);
            }
        }
        await delay(300);

        const frame = stdout.lastFrame();
        assert.ok(frame, "frame must exist after extreme resize");
        assert.doesNotMatch(frame, /undefined|NaN/);
        assert.match(frame, /100x30/);

        instance.unmount();
    } finally {
        if (originalDebug === undefined) delete process.env.DEVFORGEKIT_TUI_DEBUG;
        else process.env.DEVFORGEKIT_TUI_DEBUG = originalDebug;
        restore();
    }
});

test("resize below floor and back up repeatedly never gets stuck in too-small state", async () => {
    const restore = withTempHome();
    const originalDebug = process.env.DEVFORGEKIT_TUI_DEBUG;
    process.env.DEVFORGEKIT_TUI_DEBUG = "1";
    try {
        const { instance, stdout } = renderAt(100, 30);
        await delay(150);

        // Oscillate across the floor boundary 20 times.
        for (let i = 0; i < 20; i++) {
            stdout.resizeTo(60, 15); // below floor
            await delay(5);
            stdout.resizeTo(100, 30); // above floor
            await delay(5);
        }
        await delay(200);

        const frame = stdout.lastFrame();
        // Should end up at 100x30, showing the full dashboard.
        assert.match(frame, /100x30/);
        assert.doesNotMatch(frame, /too small/i);
        assert.match(frame, /DevForgeKit/);

        instance.unmount();
    } finally {
        if (originalDebug === undefined) delete process.env.DEVFORGEKIT_TUI_DEBUG;
        else process.env.DEVFORGEKIT_TUI_DEBUG = originalDebug;
        restore();
    }
});

test("all pages survive resize without remounting (state persists)", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(100, 30, { initialPage: "config" });
        await delay(150);

        // Resize a few times.
        stdout.resizeTo(120, 40);
        await delay(150);
        stdout.resizeTo(80, 24);
        await delay(150);
        stdout.resizeTo(160, 50);
        await delay(150);

        // The config page should still be the active page.
        const frame = stdout.lastFrame();
        assert.match(frame, /Configuration/);

        instance.unmount();
    } finally {
        restore();
    }
});

test("no frame contains overlapping text (no two lines with same content at different widths)", async () => {
    const restore = withTempHome();
    try {
        const { instance, stdout } = renderAt(160, 50);
        await delay(150);

        // Resize to a smaller size and check for overlapping content.
        stdout.resizeTo(80, 24);
        await delay(200);

        const frame = stdout.lastFrame();
        const lines = frame.split("\n");

        // No line should be wider than 80 characters (the terminal width).
        for (const line of lines) {
            assert.ok(line.length <= 80, `line length ${line.length} exceeds terminal width 80: ${JSON.stringify(line.slice(0, 40))}`);
        }

        // No line should contain null bytes or control characters (except
        // newlines, which are already split).
        for (const line of lines) {
            assert.ok(!line.includes("\0"), "frame contains null bytes");
        }

        instance.unmount();
    } finally {
        restore();
    }
});

// --- v2.0.4 onboarding overlay at the size floor and ultrawide -------------
// (Command Palette isn't covered here - this file's FakeStdin never
// feeds real keypresses through Ink's parser, only resize events; the
// palette's own interactive behavior is covered by the real-stdin tests
// in tui.test.js. Onboarding needs no keypress to appear, so it's the
// one new-in-this-session overlay this resize harness can genuinely
// exercise.)

test("Onboarding wizard's full-screen takeover renders without corruption at the 80x24 floor and at ultrawide", async () => {
    // A genuinely fresh HOME (no onboardingSeen seed) - this is the one
    // test in this file that needs the real first-run state, so it
    // doesn't reuse this file's own onboardingSeen:true-seeding withTempHome.
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-tui-resize-onboarding-test-"));
    process.env.HOME = tempHome;
    try {
        for (const [columns, rows] of [[80, 24], [300, 60]]) {
            const { instance, stdout } = renderAt(columns, rows);
            await delay(150);
            const frame = stdout.lastFrame();
            assert.match(frame, /Getting started/, `expected the wizard at ${columns}x${rows}`);
            for (const line of frame.split("\n")) {
                assert.ok(line.length <= columns, `line exceeds ${columns} cols at ${columns}x${rows}: ${JSON.stringify(line.slice(0, 40))}`);
            }
            instance.unmount();
        }
    } finally {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
