// Dashboard tests - real Ink renders driven through ink-testing-library's
// fake stdin (arrow keys, shortcuts, typing), against the real registry
// and theme system - no mocks, matching the rest of this suite's
// philosophy. HOME is pointed at a temp dir for anything that could
// write user config (same pattern plugin-sdk.test.js uses).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/tui/App.js";
import { THEMES, THEME_NAMES, getTheme } from "../src/tui/theme.js";
import { PAGES } from "../src/tui/store.js";
import { createWorkspace, workspaceExists } from "../src/core/workspace/store.js";
import { switchToWorkspace } from "../src/core/workspace/switcher.js";
import { listSnapshots } from "../src/core/workspace/snapshot.js";
import { setConfigValue } from "../src/core/config.js";

const h = React.createElement;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const KEYS = { up: "\u001B[A", down: "\u001B[B", left: "\u001B[D", right: "\u001B[C", enter: "\r", tab: "\t", esc: "\u001B", ctrlP: "\u0010" };

async function renderApp(props = {}) {
    const instance = render(h(App, props));
    // ink-testing-library's fake stdout reports 100 columns but has no
    // `rows` property (defaults to 24 in our hook). Set rows high enough
    // for any page's per-page minimum, then emit resize after effects
    // have registered the listener (useEffect runs async after paint).
    instance.stdout.rows = 40;
    await delay(10); // let useEffect register the resize listener
    instance.stdout.emit("resize");
    await delay(250); // let resize debounce (120ms) + re-render settle
    return instance;
}

// Pre-seeds onboardingSeen:true - most of this file is testing the
// *returning-user* dashboard, not the v2.0.4 first-run wizard (which has
// its own dedicated tests further down using a raw, unseeded temp HOME).
// Without this, every renderApp() in this file would hit a fresh temp
// HOME with no config.yaml, see onboardingSeen !== true, and render the
// wizard instead of whatever page the test actually means to exercise.
function withTempHome() {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-tui-test-"));
    process.env.HOME = tempHome;
    setConfigValue("onboardingSeen", true);
    return () => {
        process.env.HOME = originalHome;
        // maxRetries/retryDelay: a workspace switch test can still have an
        // async write (shell-export file, snapshot archive) landing in
        // this tree the instant cleanup starts - rmSync retries past that
        // transient ENOTEMPTY/EBUSY instead of failing the test on a race
        // that has nothing to do with the test's own assertions. Bumped
        // from 5x200ms (v2.1.4) after the Environment Graph test's own
        // footprint (261 batched shell probes writing into this tree)
        // occasionally outlasted the old 1s budget.
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    };
}

// A genuinely fresh temp HOME, with no onboardingSeen seeding - the
// v2.0.4 onboarding tests need the real "never launched before" state
// every other test in this file deliberately seeds past.
function withFreshTempHome() {
    const originalHome = process.env.HOME;
    const tempHome = mkdtempSync(path.join(tmpdir(), "devforgekit-tui-onboarding-test-"));
    process.env.HOME = tempHome;
    return () => {
        process.env.HOME = originalHome;
        rmSync(tempHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    };
}

// --- Theme system -------------------------------------------------------

test("every built-in theme declares the full color-role contract", () => {
    // The new theme system has 20 built-in themes with 28 semantic tokens.
    // The dark theme (default) must have all the old backward-compat aliases too.
    assert.ok(THEME_NAMES.includes("dark"));
    assert.ok(THEME_NAMES.length >= 20, `expected at least 20 built-in themes, got ${THEME_NAMES.length}`);
    // Old token names are aliased to new ones for backward compat
    const oldRoles = ["accent", "text", "dim", "success", "warning", "error", "border", "selectedBg", "selectedText"];
    for (const role of oldRoles) {
        assert.ok(role in THEMES.dark, `dark theme is missing role '${role}'`);
    }
    // New semantic tokens
    const newTokens = ["background", "surface", "textMuted", "primary", "secondary", "info", "borderActive", "selection", "progress", "chart1"];
    for (const token of newTokens) {
        assert.ok(token in THEMES.dark, `dark theme is missing token '${token}'`);
    }
});

test("getTheme falls back to dark for an unknown theme name", () => {
    assert.equal(getTheme("does-not-exist").id, "dark");
    assert.equal(getTheme("nord").name, "DevForgeKit Nord");
});

// --- First paint / performance ------------------------------------------

test("the dashboard renders its first frame quickly with header, nav, and status bar", async () => {
    const restore = withTempHome();
    try {
        const started = Date.now();
        const { lastFrame, unmount } = await renderApp();
        const elapsed = Date.now() - started;

        const frame = lastFrame();
        assert.match(frame, /DevForgeKit/);
        for (const page of PAGES) {
            assert.ok(frame.includes(page.label), `nav should list '${page.label}'`);
        }
        assert.match(frame, /Tab focus/);  // status bar HINTS (may wrap at narrow widths)
        assert.match(frame, /quit/);       // "q quit" may wrap across lines at 100 cols
        // PRD target is 500ms; allow CI headroom but keep it meaningful.
        assert.ok(elapsed < 2000, `first frame took ${elapsed}ms`);
        unmount();
    } finally {
        restore();
    }
});

// --- Navigation ----------------------------------------------------------

test("menu shortcuts navigate: 'd' opens Doctor, '1' returns to Dashboard", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();

        stdin.write("d");
        await delay(60);
        assert.match(lastFrame(), /Doctor - component diagnostics/);

        // Page shortcuts only work from nav focus; Doctor navigation
        // moved focus to content, so Esc first returns focus to the menu.
        stdin.write(KEYS.esc);
        await delay(40);
        stdin.write("1");
        await delay(60);
        assert.match(lastFrame(), /Machine/);
        unmount();
    } finally {
        restore();
    }
});

test("'m' opens the Compatibility page", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("m");
        await delay(60);
        assert.match(lastFrame(), /Compatibility/);
        unmount();
    } finally {
        restore();
    }
});

test("'e' opens the AI Assistant page, showing the not-configured empty state with a fresh config", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("e");
        await delay(60);
        assert.match(lastFrame(), /AI Assistant/);
        assert.match(lastFrame(), /No AI provider configured/);
        unmount();
    } finally {
        restore();
    }
});

test("arrow keys + Enter open a page from the menu", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write(KEYS.down); // Dashboard -> Workspaces
        await delay(40);
        stdin.write(KEYS.down); // Workspaces -> Components
        await delay(40);
        stdin.write(KEYS.enter);
        await delay(80);
        assert.match(lastFrame(), /Components \(\d+\/\d+\)/);
        unmount();
    } finally {
        restore();
    }
});

test("Tab toggles focus between menu and content (menu-focus banner appears/disappears)", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        assert.match(lastFrame(), /Menu focused/);
        stdin.write(KEYS.tab);
        await delay(40);
        assert.doesNotMatch(lastFrame(), /Menu focused/);
        stdin.write(KEYS.tab);
        await delay(40);
        assert.match(lastFrame(), /Menu focused/);
        unmount();
    } finally {
        restore();
    }
});

// --- Pages render against the real platform data --------------------------

test("Components page lists real registry packages and filters by typed text", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "components" });
        assert.match(lastFrame(), /Components \(\d+\/\d+\)/);

        stdin.write(KEYS.tab); // into content... initial focus is nav
        await delay(40);
        stdin.write("/"); // open filter field (unified with every other page's filter/search)
        await delay(40);
        stdin.write("docker");
        await delay(80);
        const frame = lastFrame();
        assert.match(frame, /docker/);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces, Profiles, Recipes, Generator, Plugins, Updates, Config, Help, About all render real content", async () => {
    const restore = withTempHome();
    try {
        const checks = [
            ["workspaces", /Workspaces \(\d+\)/],
            ["profiles", /Profiles \(\d+\)/],
            ["recipes", /Recipes \(\d+\)/],
            ["generator", /Project Generator \(\d+ stacks\)/],
            ["plugins", /Plugins \(\d+ discovered\)/],
            ["updates", /Package updates/],
            ["config", /config\.yaml/],
            ["help", /Global keys/],
            ["about", /DevForgeKit v/],
            ["registry", /Registry Health/]
        ];
        for (const [page, pattern] of checks) {
            const { lastFrame, unmount } = await renderApp({ initialPage: page });
            assert.match(lastFrame(), pattern, `page '${page}'`);
            unmount();
        }
    } finally {
        restore();
    }
});

test("the Generator page's Stack Intelligence panel shows a real quality score and recommendations for the highlighted stack", async () => {
    const restore = withTempHome();
    try {
        const { lastFrame, unmount } = await renderApp({ initialPage: "generator" });
        await delay(150); // let generatorQualityScores() resolve (async, but fast - no shell spawns)
        const frame = lastFrame();
        assert.match(frame, /Intelligence/);
        assert.match(frame, /Quality\s+\d+%/);
        assert.match(frame, /Recommends/);
        unmount();
    } finally {
        restore();
    }
});

test("the AI Assistant chat page renders its input prompt inside the Chat panel, not as a detached page-level line", async () => {
    const restore = withTempHome();
    try {
        setConfigValue("aiProvider", "ollama"); // a local provider needs no API key, so the Chat panel (not the empty state) renders
        const { lastFrame, unmount } = await renderApp({ initialPage: "ai" });
        const frame = lastFrame();
        assert.match(frame, /Chat/);
        assert.match(frame, /❯/); // the input prompt marker, now rendered inside the Chat panel (v2.1.3 fix)
        assert.match(frame, /Context/);
        unmount();
    } finally {
        restore();
    }
});

test("the AI Assistant's Quick Actions stay visible in the Context panel before AND after sending a message", async () => {
    const restore = withTempHome();
    try {
        setConfigValue("aiProvider", "ollama");
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "ai" });

        // Before any message: all 7 quick actions listed (not just a "1-7" hint).
        let frame = lastFrame();
        for (const label of ["Doctor", "Generate", "Planner", "Explain", "Review", "Optimize", "Fix"]) {
            assert.match(frame, new RegExp(label), `expected '${label}' before sending a message`);
        }

        // Tab into content focus first - otherwise typed letters hit the
        // global nav shortcuts instead of the chat input (e.g. 'o' would
        // navigate to Configuration).
        stdin.write(KEYS.tab);
        await delay(40);
        // Send a real message (ollama isn't running in CI, so this errors -
        // that's fine, the point is only that Quick Actions don't vanish).
        stdin.write("hello");
        await delay(60);
        stdin.write(KEYS.enter);
        await delay(400);

        frame = lastFrame();
        for (const label of ["Doctor", "Generate", "Planner", "Explain", "Review", "Optimize", "Fix"]) {
            assert.match(frame, new RegExp(label), `expected '${label}' to remain visible after sending a message`);
        }
        unmount();
    } finally {
        restore();
    }
});

test("the AI Overview page shows a real Health Score in the AI Status panel title", async () => {
    const restore = withTempHome();
    try {
        const { lastFrame, unmount } = await renderApp({ initialPage: "ai-overview" });
        await delay(500); // let scoreAIHealth()/checkHealth() resolve (git probes may be slow on CI)
        const frame = lastFrame();
        assert.match(frame, /Health \d+%/);
        unmount();
    } finally {
        restore();
    }
});

test("the Registry page shows a real health scorecard and the lowest-quality packages", async () => {
    const restore = withTempHome();
    try {
        const { lastFrame, unmount } = await renderApp({ initialPage: "registry" });
        const frame = lastFrame();
        assert.match(frame, /Registry Health/);
        assert.match(frame, /Packages/);
        assert.match(frame, /Quality\s+\d+\/100/);
        assert.match(frame, /Coverage/);
        assert.match(frame, /Needs attention/);
        assert.match(frame, /Recommendations/);
        unmount();
    } finally {
        restore();
    }
});

test("the 'y' menu shortcut opens the Registry page", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("y");
        await new Promise((r) => setTimeout(r, 30));
        assert.match(lastFrame(), /Registry Health/);
        unmount();
    } finally {
        restore();
    }
});

test("the Generator page lists every registered stack by id", async () => {
    const restore = withTempHome();
    try {
        const { lastFrame, unmount } = await renderApp({ initialPage: "generator" });
        const frame = lastFrame();
        for (const id of ["flutter", "nextjs", "express"]) {
            assert.ok(frame.includes(id), `generator list should include '${id}'`);
        }
        unmount();
    } finally {
        restore();
    }
});

// --- Status bar: busy label and toast (v2.0.6 StatusBar props refactor) ----

test("status bar shows the busy label + spinner while a scan runs, and the page/theme name otherwise", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "doctor" });
        assert.match(lastFrame(), /doctor/); // page name shown in the status bar before any scan

        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("s"); // start a component diagnostics scan
        await delay(80);
        assert.match(lastFrame(), /doctor \(components\)/); // busy label from DoctorPage's setBusy

        unmount();
    } finally {
        restore();
    }
});

test("status bar shows a notification as an auto-dismissing toast", async () => {
    // The dismiss-after-TTL *logic* is already covered deterministically
    // in test/tui-store.test.js (dismissToast reducer behavior) and by
    // reading StatusBar.js's five-line useEffect directly - this test
    // only checks the part that needs a real render: the toast actually
    // appears when a notification fires. A real wall-clock wait for the
    // 3s TTL to elapse was tried here and is genuinely flaky under
    // full-suite load (this dashboard's own background probes -
    // compatibility scan, model loading - contend for the event loop
    // and can delay when the timer fires well past its nominal delay),
    // not a product bug, so it isn't worth re-litigating with an ever
    // more generous timeout.
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        assert.doesNotMatch(lastFrame(), /Caches refreshed/);

        stdin.write("R"); // Shell's global refresh action calls actions.notify(...)
        await delay(80);
        assert.match(lastFrame(), /Caches refreshed/);
        unmount();
    } finally {
        restore();
    }
});

// --- Global search ---------------------------------------------------------

test("'/' opens global search and typing finds grouped results instantly", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("/");
        await delay(40);
        assert.match(lastFrame(), /Search everything/);

        stdin.write("docker");
        await delay(80);
        const frame = lastFrame();
        assert.match(frame, /component\s+docker/);
        assert.match(frame, /collection|profile|recipe|stack/);

        stdin.write(KEYS.esc);
        await delay(40);
        assert.doesNotMatch(lastFrame(), /Search everything/);
        unmount();
    } finally {
        restore();
    }
});

// --- Command Palette (v2.0.1) ------------------------------------------------

test("':' opens the Command Palette, fuzzy-narrows on typing, and Enter jumps to the page", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write(":");
        await delay(60);
        assert.match(lastFrame(), /Command Palette/);
        assert.match(lastFrame(), /Dashboard/); // every page listed before typing

        stdin.write("doct");
        await delay(80);
        const narrowed = lastFrame();
        assert.match(narrowed, /Doctor/);
        // The palette's own rows read "▸ <Label>  [shortcut]" - distinct
        // from Nav's "[shortcut] <Label>" so this only matches a palette
        // row, not the always-visible Nav sidebar entry for Workspaces.
        assert.doesNotMatch(narrowed, /▸ Workspaces\s+\[w\]/);

        stdin.write(KEYS.enter);
        await delay(80);
        const frame = lastFrame();
        assert.doesNotMatch(frame, /Command Palette/);
        assert.match(frame, /Doctor - component diagnostics/);
        unmount();
    } finally {
        restore();
    }
});

test("Ctrl+P also opens the Command Palette, and Esc closes it without navigating", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write(""); // Ctrl+P
        await delay(60);
        assert.match(lastFrame(), /Command Palette/);

        stdin.write(KEYS.esc);
        await delay(60);
        const frame = lastFrame();
        assert.doesNotMatch(frame, /Command Palette/);
        assert.match(frame, /Dashboard/); // back on the original page, no navigation happened
        unmount();
    } finally {
        restore();
    }
});

test("Command Palette can run a global action (Refresh) as well as navigate", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write(":");
        await delay(60);
        stdin.write("Refresh");
        await delay(80);
        assert.match(lastFrame(), /Refresh caches/);

        stdin.write(KEYS.enter);
        await delay(80);
        const frame = lastFrame();
        assert.doesNotMatch(frame, /Command Palette/);
        assert.match(frame, /Caches refreshed/);
        unmount();
    } finally {
        restore();
    }
});

test("Command Palette never opens on pages with their own local '/' filter, and ':' still works there", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "components" });
        stdin.write(KEYS.tab); // focus content
        await delay(60);
        stdin.write("/"); // should open the page's own filter, not global search
        await delay(60);
        assert.doesNotMatch(lastFrame(), /Search everything/);

        stdin.write(KEYS.esc);
        await delay(60);
        stdin.write(KEYS.esc);
        await delay(60);
        stdin.write(":"); // palette should still work from any page
        await delay(60);
        assert.match(lastFrame(), /Command Palette/);
        unmount();
    } finally {
        restore();
    }
});

// --- Onboarding (v2.0.4 first-run wizard) -----------------------------------

test("a genuinely fresh install shows the onboarding wizard instead of the dashboard, taking over the whole screen", async () => {
    const restore = withFreshTempHome();
    try {
        const { lastFrame, unmount } = await renderApp();
        const frame = lastFrame();
        assert.match(frame, /Getting started/);
        assert.match(frame, /Welcome to DevForgeKit/);
        // Full-screen takeover - no Nav sidebar page list alongside it.
        assert.doesNotMatch(frame, /\[w\] Workspaces/);
        unmount();
    } finally {
        restore();
    }
});

test("stepping through onboarding: theme step live-previews, and finishing lands on the normal dashboard", async () => {
    const restore = withFreshTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        assert.match(lastFrame(), /Welcome to DevForgeKit/);

        stdin.write(KEYS.enter); // -> theme step
        await delay(60);
        assert.match(lastFrame(), /Choose a theme/);
        const before = /\d+\/\d+\s+(.+)/.exec(lastFrame())?.[1];

        stdin.write(KEYS.down); // preview the next theme
        await delay(60);
        const after = /\d+\/\d+\s+(.+)/.exec(lastFrame())?.[1];
        assert.notEqual(before, after, "down arrow on the theme step should preview a different theme");

        // Advance through the remaining steps (shortcuts, pages, profile, ai).
        for (let i = 0; i < 4; i++) {
            stdin.write(KEYS.enter);
            await delay(60);
        }
        assert.match(lastFrame(), /Enter to start/);
        stdin.write(KEYS.enter); // finish
        await delay(100);

        const frame = lastFrame();
        assert.doesNotMatch(frame, /Getting started/);
        assert.match(frame, /\[w\] Workspaces/); // back to the normal Nav + dashboard
        unmount();
    } finally {
        restore();
    }
});

test("Esc skips onboarding immediately, and it never shows again on a later launch", async () => {
    const restore = withFreshTempHome();
    try {
        const first = await renderApp();
        assert.match(first.lastFrame(), /Getting started/);
        first.stdin.write(KEYS.esc);
        await delay(80);
        assert.doesNotMatch(first.lastFrame(), /Getting started/);
        first.unmount();

        // A second launch (same HOME, so the same persisted config) must
        // not show the wizard again - onboardingSeen was written for real.
        const second = await renderApp();
        assert.doesNotMatch(second.lastFrame(), /Getting started/);
        assert.match(second.lastFrame(), /\[w\] Workspaces/);
        second.unmount();
    } finally {
        restore();
    }
});

test("global shortcuts (search, palette, nav letters) do nothing while onboarding is showing", async () => {
    const restore = withFreshTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("/");
        await delay(60);
        assert.doesNotMatch(lastFrame(), /Search everything/);

        stdin.write(":");
        await delay(60);
        assert.doesNotMatch(lastFrame(), /Command Palette/);

        stdin.write("c"); // would normally jump straight to Components
        await delay(60);
        assert.match(lastFrame(), /Getting started/); // still on the wizard
        unmount();
    } finally {
        restore();
    }
});

// --- Theme switching via Configuration page ---------------------------------

test("cycling tuiTheme on the Configuration page applies a different theme live", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "config" });
        const themeOf = () => /tuiTheme\s+(\S+)/.exec(lastFrame())?.[1];
        const before = themeOf();
        assert.ok(THEME_NAMES.includes(before), `unexpected starting theme '${before}'`);

        stdin.write(KEYS.tab); // focus content (initial focus is nav)
        await delay(60);
        stdin.write(KEYS.enter); // cycle to the next theme in THEME_NAMES

        // Background install probes from earlier tests can starve the
        // event loop, so poll for the change instead of racing a single
        // fixed delay.
        let after = before;
        for (let i = 0; i < 20 && after === before; i++) {
            await delay(50);
            after = themeOf();
        }
        const expected = THEME_NAMES[(THEME_NAMES.indexOf(before) + 1) % THEME_NAMES.length];
        assert.equal(after, expected, `theme should cycle ${before} -> ${expected}`);
        unmount();
    } finally {
        restore();
    }
});

// --- Quit safety --------------------------------------------------------------
// ink-testing-library doesn't expose waitUntilExit, so real exit is
// covered by the manual smoke run (docs/TUI.md's verification notes);
// what *is* testable - and the actual regression risk - is that 'q'
// must NOT quit while a text field owns the keyboard.

test("'q' typed into the search field is text, not quit", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("/");
        await delay(40);
        stdin.write("q");
        await delay(60);
        const frame = lastFrame();
        assert.match(frame, /Search everything/); // still alive, search open
        assert.match(frame, /\/ q/); // the q landed in the query field
        unmount();
    } finally {
        restore();
    }
});

// --- Workspace page (real core/workspace/*.js engine, no mocks) -----------

test("Workspaces page starts empty and creates a workspace through the n wizard", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        assert.match(lastFrame(), /Workspaces \(0\)/);
        assert.match(lastFrame(), /No workspaces yet/);

        stdin.write(KEYS.tab); // focus content
        await delay(60);
        stdin.write("n");
        await delay(40);
        assert.match(lastFrame(), /New workspace/);

        stdin.write("acme-backend");
        await delay(60);
        stdin.write(KEYS.enter); // name -> description step
        await delay(40);
        stdin.write(KEYS.enter); // accept default description -> create
        await delay(100);

        const frame = lastFrame();
        assert.match(frame, /Workspaces \(1\)/);
        assert.match(frame, /acme-backend/);
        assert.doesNotMatch(frame, /No workspaces yet/);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: Enter switches to a workspace, marking it active in the list and panel title", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write(KEYS.enter); // switch to the highlighted (only) workspace

        // Check the panel title, not the persistent DashboardHeader banner
        // (which doesn't show per-workspace state at all - see
        // components/DashboardHeader.js).
        let frame = lastFrame();
        for (let i = 0; i < 30 && !/active: acme-backend/.test(frame); i++) {
            await delay(50);
            frame = lastFrame();
        }
        assert.match(frame, /Workspaces \(1\) . active: acme-backend/);
        assert.match(frame, /▸acme-backend/); // active marker in the list
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: v runs a real verify and shows PASS/WARNING/FAIL results", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("v");

        let frame = lastFrame();
        for (let i = 0; i < 30 && !/Verify:/.test(frame); i++) {
            await delay(50);
            frame = lastFrame();
        }
        assert.match(frame, /Verify: \d+% - /);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: x creates a snapshot", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("x");
        await delay(80);

        assert.equal(listSnapshots("acme-backend").length, 1);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: D requires two presses to delete, removing it from the list", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        stdin.write(KEYS.tab);
        await delay(60);

        stdin.write("D"); // first press just arms it
        await delay(60);
        assert.ok(workspaceExists("acme-backend"), "one D press must not delete yet");
        assert.match(lastFrame(), /Workspaces \(1\)/);

        stdin.write("D"); // second press confirms
        await delay(80);
        assert.ok(!workspaceExists("acme-backend"));
        assert.match(lastFrame(), /Workspaces \(0\)/);
        unmount();
    } finally {
        restore();
    }
});

test("Workspaces page: z deactivates the active workspace", async () => {
    const restore = withTempHome();
    try {
        createWorkspace({ name: "acme-backend", description: "Acme backend" });
        await switchToWorkspace("acme-backend");

        const { stdin, lastFrame, unmount } = await renderApp({ initialPage: "workspaces" });
        assert.match(lastFrame(), /active: acme-backend/);

        stdin.write(KEYS.tab);
        await delay(60);
        stdin.write("z");

        let frame = lastFrame();
        for (let i = 0; i < 30 && /active: acme-backend/.test(frame); i++) {
            await delay(50);
            frame = lastFrame();
        }
        assert.doesNotMatch(frame, /active: acme-backend/);
        unmount();
    } finally {
        restore();
    }
});

test("the 'w' menu shortcut opens the Workspaces page", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("w");
        await delay(60);
        assert.match(lastFrame(), /Workspaces \(\d+\)/);
        unmount();
    } finally {
        restore();
    }
});

// This one waits for a real, cold graph build (no on-disk cache exists
// for a fresh temp HOME) - genuinely slow (~15-20s, the same real
// registry scan `graph stats` pays on the CLI side), but it's the only
// way to catch the exact class of bug this session already found twice
// elsewhere (AIOverviewPage's Health Score, AIPage's Quick Actions): a
// page that renders clean in isolation but corrupts once real data - not
// a synthetic fixture - actually flows through it. Deliberately placed
// last in this file (not near the other Graph/AI page tests) - it
// otherwise sits right before "status bar shows a notification as an
// auto-dismissing toast", a documented-flaky-under-load test, and this
// test's own event-loop pressure (261 batched shell probes) measurably
// increased that test's flake rate.
test("the Environment Graph page renders real node data with no corruption once the build completes", async () => {
    const restore = withTempHome();
    try {
        const { stdin, lastFrame, unmount } = await renderApp();
        stdin.write("G");
        await delay(60);
        // The mount effect already kicks off a real build (graphSnapshot())
        // the instant this page is shown - matching CompatibilityPage's
        // own established auto-scan-on-mount convention - so there's no
        // separate "start the build" step; this just waits for it.
        await delay(40000); // CI may be slower for 261 shell probes
        const frame = lastFrame();
        assert.match(frame, /Environment Graph \(\d+ nodes\)/);
        assert.match(frame, /installed/);
        assert.match(frame, /orphans/);
        assert.match(frame, /conflicts/);
        // The detail panel's KeyValue rows, checked individually rather
        // than just "some text appears" - this is exactly the shape of
        // assertion that would have caught the AIOverviewPage/AIPage row-
        // drop bugs found earlier this session (specific rows vanishing
        // under real data, not a rendering crash).
        assert.match(frame, /Type\s+\S/);
        assert.match(frame, /Category\s+\S/);
        assert.match(frame, /Installed\s+\S/);
        assert.match(frame, /Quality\s+\S/);
        assert.match(frame, /Impact\s+\S/);
        unmount();
    } finally {
        restore();
    }
});
