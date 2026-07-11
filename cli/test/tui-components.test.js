// Shared TUI component library tests - render each new primitive from
// components/ui.js directly through ink-testing-library, same real-render
// philosophy as tui.test.js, but scoped to one component at a time instead
// of driving the whole dashboard. Every render() is explicitly unmount()ed -
// Spinner (used by LoadingState) runs a real setInterval that only clears
// on unmount, and a leaked interval hangs `node --test` waiting for the
// event loop to drain instead of exiting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "ink";
import { render } from "ink-testing-library";
import {
    h, Badge, StatusIndicator, Card, EmptyState, ErrorState, LoadingState,
    Table, ScrollList, SelectList, useFilterField, FilterBar, DetailPanel,
    PageShell, computeWindowStart
} from "../src/tui/components/ui.js";
import { getTheme } from "../src/tui/theme.js";
import { TerminalSizeProvider } from "../src/tui/hooks/useTerminalSize.js";

const theme = getTheme("dark");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Ink re-renders asynchronously after a simulated stdin event; a fixed
// delay is a real, observed flake source under CI load (a run failed
// here: the assertion ran against a stale frame because the re-render
// hadn't committed yet within the fixed window). Poll until the
// condition is true or a generous timeout elapses instead - this
// resolves just as fast as a fixed delay under normal load and only
// waits longer when the runner is genuinely under contention.
// Deliberately checks *after* the first delay, never before: Ink attaches
// its raw-mode stdin 'readable' listener from a useEffect that only runs
// on a later event-loop turn, not synchronously during render(). A
// check-then-delay loop can resolve on the very first (already-true)
// check with zero ticks elapsed - which starved that effect from ever
// running before the next stdin.write(), causing every keypress after it
// to be silently dropped forever (confirmed live: not a timing flake,
// a deterministic hang, self-inflicted by an earlier version of this
// exact helper).
async function waitForCondition(check, { timeout = 2000, interval = 10 } = {}) {
    const start = Date.now();
    do {
        await delay(interval);
        if (check()) return;
    } while (Date.now() - start < timeout);
    if (!check()) {
        throw new Error(`waitForCondition: condition not met within ${timeout}ms`);
    }
}
const waitForFrame = (lastFrame, pattern, opts) => waitForCondition(() => pattern.test(lastFrame()), opts);
// Built via String.fromCharCode rather than a literal escape in source -
// tooling that touches this file can mangle a raw \x1B byte in a string
// literal, so we construct it at runtime instead.
const ESC = String.fromCharCode(27);
const KEYS = { pageUp: `${ESC}[5~`, pageDown: `${ESC}[6~`, esc: ESC };

// --- computeWindowStart --------------------------------------------------

test("computeWindowStart clamps into [0, itemCount-height]", () => {
    assert.equal(computeWindowStart(-5, 100, 10), 0);
    assert.equal(computeWindowStart(50, 100, 10), 50);
    assert.equal(computeWindowStart(999, 100, 10), 90);
    assert.equal(computeWindowStart(5, 3, 10), 0); // fewer items than height
});

// --- Badge / StatusIndicator ---------------------------------------------

test("Badge renders bracketed text", () => {
    const { lastFrame, unmount } = render(h(Badge, { text: "stable", tone: "success", theme }));
    assert.match(lastFrame(), /\[ stable \]/);
    unmount();
});

test("StatusIndicator maps PASS/WARNING/FAIL to distinct icons", () => {
    let r = render(h(StatusIndicator, { status: "PASS", theme }));
    assert.match(r.lastFrame(), /✓/);
    r.unmount();
    r = render(h(StatusIndicator, { status: "WARNING", theme }));
    assert.match(r.lastFrame(), /⚠/);
    r.unmount();
    r = render(h(StatusIndicator, { status: "FAIL", theme }));
    assert.match(r.lastFrame(), /✗/);
    r.unmount();
});

// --- Card / EmptyState / ErrorState / LoadingState -----------------------

test("Card renders a title and its KeyValue pairs", () => {
    const { lastFrame, unmount } = render(h(Card, { title: "Machine", theme, pairs: [["Health", "100%"]] }));
    const frame = lastFrame();
    assert.match(frame, /Machine/);
    assert.match(frame, /Health/);
    assert.match(frame, /100%/);
    unmount();
});

test("EmptyState shows title, description, and hint distinctly", () => {
    const { lastFrame, unmount } = render(h(EmptyState, {
        title: "No profiles yet.", description: "Profiles bundle collections + components.", hint: "Press n to create one.", theme
    }));
    const frame = lastFrame();
    assert.match(frame, /No profiles yet\./);
    assert.match(frame, /bundle collections/);
    assert.match(frame, /Press n to create one\./);
    unmount();
});

test("ErrorState surfaces the message", () => {
    const { lastFrame, unmount } = render(h(ErrorState, { message: "Registry failed to load: boom", theme }));
    assert.match(lastFrame(), /Registry failed to load: boom/);
    unmount();
});

test("LoadingState shows the label alongside the spinner", () => {
    const { lastFrame, unmount } = render(h(TerminalSizeProvider, null, h(LoadingState, { label: "Fetching models...", theme })));
    assert.match(lastFrame(), /Fetching models\.\.\./);
    unmount();
});

// --- Table ----------------------------------------------------------------

test("Table renders a header row and aligned data rows", () => {
    const { lastFrame, unmount } = render(h(Table, {
        theme,
        columns: [{ key: "name", label: "Name", width: 10 }, { key: "status", label: "Status", width: 8 }],
        rows: [{ id: 1, name: "flutter", status: "stable" }, { id: 2, name: "docker", status: "beta" }]
    }));
    const frame = lastFrame();
    assert.match(frame, /Name/);
    assert.match(frame, /Status/);
    assert.match(frame, /flutter/);
    assert.match(frame, /docker/);
    unmount();
});

// --- ScrollList ------------------------------------------------------------

test("ScrollList shows a windowed view with 'more' indicators and scrolls with j/k", async () => {
    const items = Array.from({ length: 30 }, (_, i) => `item-${i}`);
    const { lastFrame, stdin, unmount } = render(h(ScrollList, {
        items, isActive: true, height: 5, theme,
        renderItem: (item, index) => h(Text, { key: index }, item)
    }));
    await waitForFrame(lastFrame, /↓ 25 more/);
    assert.match(lastFrame(), /item-0/);
    assert.match(lastFrame(), /↓ 25 more/);

    stdin.write("G"); // jump to bottom
    await waitForFrame(lastFrame, /item-29/);
    assert.match(lastFrame(), /item-29/);
    assert.match(lastFrame(), /↑ 25 more/);

    stdin.write("g"); // jump back to top
    await waitForFrame(lastFrame, /item-0/);
    assert.match(lastFrame(), /item-0/);
    unmount();
});

test("SelectList supports PageDown/PageUp and g/G in addition to arrows", async () => {
    const items = Array.from({ length: 20 }, (_, i) => `row-${i}`);
    let highlighted = null;
    const { stdin, unmount } = render(h(SelectList, {
        items, isActive: true, height: 5, theme,
        onHighlight: (item) => { highlighted = item; }
    }));
    await delay(20); // initial mount settle - onHighlight only fires in response to a keypress, nothing to poll for yet
    stdin.write(KEYS.pageDown);
    await waitForCondition(() => highlighted === "row-5");
    assert.equal(highlighted, "row-5");
    stdin.write("G");
    await waitForCondition(() => highlighted === "row-19");
    assert.equal(highlighted, "row-19");
    stdin.write("g");
    await waitForCondition(() => highlighted === "row-0");
    assert.equal(highlighted, "row-0");
    unmount();
});

// --- useFilterField / FilterBar -------------------------------------------

function FilterHarness({ onTypingChange }) {
    const { query, isOpen } = useFilterField({ isActive: true, onTypingChange });
    return h(FilterBar, { query, isOpen, isActive: isOpen, theme, onChange: () => {} });
}

test("useFilterField opens on '/' and reports typing changes, closes on Esc", async () => {
    const typingEvents = [];
    const { lastFrame, stdin, unmount } = render(
        h(FilterHarness, { onTypingChange: (v) => typingEvents.push(v) }));
    await delay(20); // initial mount settle - nothing to poll for yet
    assert.equal(lastFrame(), ""); // closed: FilterBar renders nothing

    stdin.write("/");
    await waitForCondition(() => typingEvents.length === 1);
    assert.match(lastFrame(), /Type to filter/);
    assert.deepEqual(typingEvents, [true]);

    stdin.write(KEYS.esc);
    await waitForCondition(() => typingEvents.length === 2);
    assert.equal(lastFrame(), "");
    assert.deepEqual(typingEvents, [true, false]);
    unmount();
});

// --- DetailPanel / PageShell -----------------------------------------------

test("DetailPanel renders sectioned KeyValue pairs plus trailing hints", () => {
    const { lastFrame, unmount } = render(h(DetailPanel, {
        title: "flutter", theme,
        sections: [{ title: "Overview", pairs: [["Version", "3.24.0"]] }],
        hints: [["i", "install"]]
    }));
    const frame = lastFrame();
    assert.match(frame, /flutter/);
    assert.match(frame, /Overview/);
    assert.match(frame, /3\.24\.0/);
    assert.match(frame, /install/);
    unmount();
});

test("DetailPanel shows emptyText when nothing is selected", () => {
    const { lastFrame, unmount } = render(h(DetailPanel, { title: "Detail", theme, sections: [], emptyText: "Select an item." }));
    assert.match(lastFrame(), /Select an item\./);
    unmount();
});

test("PageShell renders children and a bottom KeyHints row", () => {
    const { lastFrame, unmount } = render(h(PageShell, {
        theme, hints: [["q", "quit"]]
    }, h(Text, null, "page body")));
    const frame = lastFrame();
    assert.match(frame, /page body/);
    assert.match(frame, /quit/);
    unmount();
});
