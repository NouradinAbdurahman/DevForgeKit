// The Benchmark Engine (v1.3.3). Measures the performance of the user's
// development environment using real developer workloads - not synthetic
// CPU benchmarks. Every benchmark runs in an isolated temporary directory
// that is cleaned up automatically; user projects are never touched.
//
// Three profiles:
//   quick    (~10-20s)  - CPU, disk, git, node startup, shell, memory
//   standard (~30-60s)  - quick + docker, flutter, python, databases, pkg managers
//   full     (~2-5min)  - everything including project generation
//
// Scoring: each category gets 0-100, overall is the average of available
// categories. Grades: A+ (95+), A (90+), B (80+), C (70+), D (60+), F (<60).
//
// Results stored in ~/.devforgekit/benchmarks/<id>.json with full metadata.
//
// Reuses: shell.js (runShellCommand/captureShellCommand), compatibility
// engine (scanCompatibility for known issues), registry (loadPackages for
// installed component detection), version.js, paths.js, logger.js, AI
// providers for explanations, project generator for project benchmarks.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { tmpdir, hostname, arch, cpus, totalmem, freemem } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";
import { runShellCommand, captureShellCommand, commandExists, shellQuote } from "./shell.js";
import { userStateDir } from "./paths.js";
import { getVersion } from "../version.js";
import { logger } from "./logger.js";
import { DevForgeError } from "./errors.js";
import { scanCompatibility, currentPlatform, currentArchitecture } from "./compatibility/engine.js";
import { loadPackages } from "./registry.js";
import { validate } from "./installer.js";
import { mapWithConcurrency } from "./concurrency.js";
import { scoreResults } from "./health.js";

// ─── Constants ────────────────────────────────────────────────────────

export const BENCHMARK_VERSION = 2;
export const BENCHMARK_DIR = "benchmarks";

// Default number of runs per measurement for variance calculation
const DEFAULT_RUNS = 3;

// Significance threshold for comparison (percentage change)
const SIGNIFICANCE_THRESHOLD = 0.10; // 10% change is significant

const PROFILES = {
    quick: ["cpu", "memory", "disk", "git", "node", "shell"],
    standard: ["cpu", "memory", "disk", "git", "node", "shell", "docker", "flutter", "python", "databases", "packageManagers"],
    full: ["cpu", "memory", "disk", "git", "node", "shell", "docker", "flutter", "python", "databases", "packageManagers", "projectGeneration"]
};

// Expected times (ms) for scoring. Score = min(100, 100 * expected / actual).
// A result at the expected time scores 100; twice as slow scores 50.
const EXPECTED_TIMES = {
    cpu: { compression: 500, decompression: 200, jsonParse: 50, objectCreation: 100 },
    memory: { allocation: 100, largeArrays: 200, gc: 100 },
    disk: { sequentialWrite: 500, sequentialRead: 300, randomAccess: 1000, smallFiles: 2000 },
    git: { init: 200, status: 100, add: 200, commit: 500, branch: 100, diff: 100 },
    node: { startup: 100, moduleLoad: 200 },
    shell: { startup: 200, prompt: 300 },
    docker: { daemon: 1000, containerStart: 5000, imageInspect: 1000 },
    flutter: { doctor: 5000, pubGet: 10000 },
    python: { startup: 100, venv: 3000, pipInstall: 10000 },
    databases: { postgresPing: 500, mysqlPing: 500, redisPing: 200 },
    packageManagers: { brew: 2000, npm: 1000, pnpm: 500, bun: 300 },
    projectGeneration: { nextjs: 30000, express: 5000, fastapi: 5000, flutter: 30000 }
};

// ─── Helpers ──────────────────────────────────────────────────────────

function benchmarksDir() {
    return path.join(userStateDir(), BENCHMARK_DIR);
}

function tempDir(prefix) {
    return mkdtempSync(path.join(tmpdir(), prefix));
}

// withTempDir — helper to eliminate repeated try/finally rmSync pattern.
// Creates a temp dir, passes it to fn, and always cleans up.
async function withTempDir(prefix, fn) {
    const dir = tempDir(prefix);
    try {
        return await fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function makeBenchmarkId(isoTimestamp) {
    return `${isoTimestamp.replace(/[:.]/g, "-")}-${crypto.randomBytes(4).toString("hex")}`;
}

export function gradeForScore(score) {
    if (score >= 95) return "A+";
    if (score >= 90) return "A";
    if (score >= 80) return "B";
    if (score >= 70) return "C";
    if (score >= 60) return "D";
    return "F";
}

function scoreTime(actualMs, expectedMs) {
    if (actualMs == null || expectedMs == null) return null;
    if (actualMs <= 0) return 100;
    return Math.min(100, Math.max(0, Math.round(100 * expectedMs / actualMs)));
}

function scoreCategory(measurements) {
    const scores = [];
    for (const [name, actualMs] of Object.entries(measurements)) {
        if (actualMs == null) continue;
        const expected = EXPECTED_TIMES[name] || actualMs;
        const s = scoreTime(actualMs, expected);
        if (s != null) scores.push(s);
    }
    if (scores.length === 0) return null;
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function computeOverall(categoryScores) {
    const valid = Object.values(categoryScores).filter((s) => s != null);
    if (valid.length === 0) return 0;
    return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

async function timeOperation(fn) {
    const start = performance.now();
    try {
        await fn();
    } catch {
        return null;
    }
    return Math.round(performance.now() - start);
}

// timeOperationMulti — runs fn `runs` times, returns { median, min, max, variance, confidence, runs }
// confidence is 0-1 based on variance relative to median
async function timeOperationMulti(fn, runs = DEFAULT_RUNS) {
    const times = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        try {
            await fn();
            times.push(Math.round(performance.now() - start));
        } catch {
            return null;
        }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const min = times[0];
    const max = times[times.length - 1];
    const mean = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
    const variance = Math.round(
        times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / times.length
    );
    // Confidence: 1.0 when variance is 0, decreases as variance grows
    const confidence = median > 0 ? Math.max(0, Math.min(1, 1 - (Math.sqrt(variance) / median))) : 0;
    return { median, min, max, mean, variance, confidence, runs };
}

async function timeShell(cmd, opts = {}) {
    return timeOperation(async () => {
        const code = await runShellCommand(cmd, { silent: true, ...opts });
        if (code !== 0) throw new Error(`Command failed: ${cmd}`);
    });
}

// timeShellMulti — runs a shell command multiple times for variance data
async function timeShellMulti(cmd, opts = {}, runs = DEFAULT_RUNS) {
    return timeOperationMulti(async () => {
        const code = await runShellCommand(cmd, { silent: true, ...opts });
        if (code !== 0) throw new Error(`Command failed: ${cmd}`);
    }, runs);
}

async function toolAvailable(name) {
    return commandExists(name);
}

// ─── CPU Benchmarks ───────────────────────────────────────────────────

async function benchmarkCPU() {
    const results = {};

    // Compression: create a large text file and gzip it
    results.compression = await timeOperation(async () => {
        const dir = tempDir("bench-cpu-");
        try {
            const filePath = path.join(dir, "large.txt");
            const chunk = "x".repeat(1024);
            writeFileSync(filePath, chunk.repeat(1024)); // 1MB
            await timeShell(`gzip -f ${shellQuote(filePath)}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // Decompression
    results.decompression = await timeOperation(async () => {
        const dir = tempDir("bench-cpu-decomp-");
        try {
            const filePath = path.join(dir, "large.txt");
            writeFileSync(filePath, "x".repeat(1024 * 1024));
            await timeShell(`gzip -f ${shellQuote(filePath)}`);
            await timeShell(`gunzip -f ${shellQuote(filePath + ".gz")}`);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    // JSON parsing
    results.jsonParse = await timeOperation(async () => {
        const data = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `item-${i}`, value: Math.random() }));
        const json = JSON.stringify(data);
        JSON.parse(json);
    });

    // Large object creation
    results.objectCreation = await timeOperation(async () => {
        const arr = [];
        for (let i = 0; i < 100000; i++) {
            arr.push({ index: i, data: `item-${i}`, nested: { a: i, b: i * 2 } });
        }
        return arr.length;
    });

    return results;
}

// ─── Memory Benchmarks ────────────────────────────────────────────────

async function benchmarkMemory() {
    const results = {};

    // Allocation
    results.allocation = await timeOperation(() => {
        const buffers = [];
        for (let i = 0; i < 1000; i++) {
            buffers.push(Buffer.alloc(1024 * 100)); // 100KB each, 100MB total
        }
        return buffers.length;
    });

    // Large arrays
    results.largeArrays = await timeOperation(() => {
        const arrays = [];
        for (let i = 0; i < 10; i++) {
            arrays.push(new Array(1000000).fill(i));
        }
        return arrays.length;
    });

    // GC
    results.gc = await timeOperation(() => {
        if (global.gc) {
            global.gc();
        } else {
            // Force GC pressure
            for (let i = 0; i < 5; i++) {
                const arr = new Array(1000000).fill(null);
                arr.length = 0;
            }
        }
    });

    return results;
}

// ─── Disk Benchmarks ──────────────────────────────────────────────────

async function benchmarkDisk() {
    const results = {};
    const dir = tempDir("bench-disk-");

    try {
        // Sequential write
        results.sequentialWrite = await timeOperation(() => {
            const filePath = path.join(dir, "seq-write.bin");
            const buf = Buffer.alloc(1024 * 1024 * 10); // 10MB
            writeFileSync(filePath, buf);
        });

        // Sequential read
        results.sequentialRead = await timeOperation(() => {
            const filePath = path.join(dir, "seq-write.bin");
            readFileSync(filePath);
        });

        // Random access
        results.randomAccess = await timeOperation(() => {
            const filePath = path.join(dir, "random.bin");
            writeFileSync(filePath, Buffer.alloc(1024 * 1024));
            const fd = openSync(filePath, "r");
            try {
                for (let i = 0; i < 100; i++) {
                    const offset = Math.floor(Math.random() * (1024 * 1024 - 4096));
                    const buf = Buffer.alloc(4096);
                    readSync(fd, buf, 0, 4096, offset);
                }
            } finally {
                closeSync(fd);
            }
        });

        // Small files
        results.smallFiles = await timeOperation(() => {
            const subDir = path.join(dir, "small");
            mkdirSync(subDir, { recursive: true });
            for (let i = 0; i < 100; i++) {
                writeFileSync(path.join(subDir, `file-${i}.txt`), `content ${i}`);
            }
        });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Git Benchmarks ───────────────────────────────────────────────────

async function benchmarkGit() {
    const results = {};
    const dir = tempDir("bench-git-");

    try {
        // Init
        results.init = await timeShell(`git init ${shellQuote(dir)}`);

        // Create a file and add
        const filePath = path.join(dir, "test.txt");
        writeFileSync(filePath, "initial content\n");

        results.add = await timeShell(`git -C ${shellQuote(dir)} add test.txt`);

        // Commit
        results.commit = await timeShell(
            `git -C ${shellQuote(dir)} -c user.name="Bench" -c user.email="bench@test" commit -m "initial"`
        );

        // Status
        results.status = await timeShell(`git -C ${shellQuote(dir)} status --porcelain`);

        // Branch creation
        results.branch = await timeShell(`git -C ${shellQuote(dir)} branch test-branch`);

        // Diff
        writeFileSync(filePath, "modified content\n");
        results.diff = await timeShell(`git -C ${shellQuote(dir)} diff`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Node.js Benchmarks ───────────────────────────────────────────────

async function benchmarkNode() {
    const results = {};

    // Startup
    results.startup = await timeShell("node -e 'process.exit(0)'");

    // Module load
    results.moduleLoad = await timeShell("node -e 'require(\"fs\"); require(\"path\"); require(\"crypto\")'");

    return results;
}

// ─── Shell Benchmarks ─────────────────────────────────────────────────

async function benchmarkShell() {
    const results = {};

    // Shell startup
    results.startup = await timeShell("echo ok");

    // Prompt rendering (simulated - time to source a basic profile)
    results.prompt = await timeShell("source /etc/profile 2>/dev/null; echo ok");

    return results;
}

// ─── Docker Benchmarks ────────────────────────────────────────────────

async function benchmarkDocker() {
    const results = {};

    if (!(await toolAvailable("docker"))) {
        return { skipped: "docker not installed" };
    }

    // Daemon responsiveness
    results.daemon = await timeShell("docker info --format '{{.ServerVersion}}' 2>/dev/null");

    // Image inspect (use hello-world if available, pull if needed)
    results.imageInspect = await timeShell("docker image inspect hello-world --format '{{.Id}}' 2>/dev/null || docker pull hello-world 2>/dev/null && docker image inspect hello-world --format '{{.Id}}' 2>/dev/null");

    // Container startup
    results.containerStart = await timeShell("docker run --rm hello-world 2>/dev/null");

    return results;
}

// ─── Flutter Benchmarks ───────────────────────────────────────────────

async function benchmarkFlutter() {
    const results = {};

    if (!(await toolAvailable("flutter"))) {
        return { skipped: "flutter not installed" };
    }

    // Flutter doctor
    results.doctor = await timeShell("flutter doctor 2>/dev/null");

    // Pub get on a temp project
    const dir = tempDir("bench-flutter-");
    try {
        await timeShell(`flutter create temp_project --project-name bench 2>/dev/null`, { cwd: dir });
        results.pubGet = await timeShell(`flutter pub get 2>/dev/null`, { cwd: path.join(dir, "temp_project") });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Python Benchmarks ────────────────────────────────────────────────

async function benchmarkPython() {
    const results = {};

    if (!(await toolAvailable("python3"))) {
        return { skipped: "python3 not installed" };
    }

    // Startup
    results.startup = await timeShell("python3 -c 'pass'");

    // Venv creation
    const dir = tempDir("bench-python-");
    try {
        results.venv = await timeShell(`python3 -m venv ${shellQuote(path.join(dir, "venv"))}`);

        // Pip install (small package)
        results.pipInstall = await timeShell(
            `${shellQuote(path.join(dir, "venv", "bin", "pip"))} install --quiet six 2>/dev/null`
        );
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Database Benchmarks ──────────────────────────────────────────────

async function benchmarkDatabases() {
    const results = {};

    // PostgreSQL
    if (await toolAvailable("psql")) {
        results.postgresPing = await timeShell("psql -lqt 2>/dev/null | head -1");
    }

    // MySQL
    if (await toolAvailable("mysql")) {
        results.mysqlPing = await timeShell("mysql -e 'SELECT 1' 2>/dev/null");
    }

    // Redis
    if (await toolAvailable("redis-cli")) {
        results.redisPing = await timeShell("redis-cli ping 2>/dev/null");
    }

    return results;
}

// ─── Package Manager Benchmarks ───────────────────────────────────────

async function benchmarkPackageManagers() {
    const results = {};

    // Homebrew
    if (await toolAvailable("brew")) {
        results.brew = await timeShell("brew --version 2>/dev/null");
    }

    // npm
    if (await toolAvailable("npm")) {
        results.npm = await timeShell("npm --version 2>/dev/null");
    }

    // pnpm
    if (await toolAvailable("pnpm")) {
        results.pnpm = await timeShell("pnpm --version 2>/dev/null");
    }

    // bun
    if (await toolAvailable("bun")) {
        results.bun = await timeShell("bun --version 2>/dev/null");
    }

    return results;
}

// ─── Project Generation Benchmarks ────────────────────────────────────

async function benchmarkProjectGeneration() {
    const results = {};
    const dir = tempDir("bench-projgen-");

    try {
        // Express (fast, always available via Node)
        if (await toolAvailable("node")) {
            results.express = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("express");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench-express",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }

        // FastAPI (if python available)
        if (await toolAvailable("python3")) {
            results.fastapi = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("fastapi");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench-fastapi",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }

        // Next.js (if npx available)
        if (await toolAvailable("npx")) {
            results.nextjs = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("nextjs");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench-nextjs",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }

        // Flutter (if flutter available)
        if (await toolAvailable("flutter")) {
            results.flutter = await timeOperation(async () => {
                const { getGenerator } = await import("../generators/index.js");
                const { runProjectGenerator } = await import("./projectGenerator.js");
                const gen = getGenerator("flutter");
                if (gen) {
                    await runProjectGenerator(gen, {
                        name: "bench_flutter",
                        parentDir: dir,
                        assumeYes: true
                    });
                }
            });
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    return results;
}

// ─── Benchmark Registry ───────────────────────────────────────────────

// BENCHMARK_METADATA — rich metadata for each benchmark category.
// Used by benchmark intelligence (Phase 6) and reports (Phase 3).
export const BENCHMARK_METADATA = {
    cpu: {
        label: "CPU",
        description: "Processor speed for compression, decompression, JSON parsing, and object creation.",
        why: "CPU performance affects build times, compilation, and any compute-heavy toolchain.",
        affects: ["Build speed", "Compilation", "Data processing"],
        expectedRange: "50-500ms per operation",
        recommendation: "Close background processes, ensure adequate cooling, or upgrade hardware."
    },
    memory: {
        label: "Memory",
        description: "RAM allocation, large array handling, and garbage collection speed.",
        why: "Memory performance affects multi-tasking, large project builds, and running multiple tools.",
        affects: ["Multi-tasking", "Large builds", "Container overhead"],
        expectedRange: "50-300ms per operation",
        recommendation: "Ensure adequate free RAM, close memory-hungry apps, or add more RAM."
    },
    disk: {
        label: "Disk",
        description: "Sequential read/write, random access, and small file creation speed.",
        why: "Disk I/O is often the biggest bottleneck for development workflows.",
        affects: ["File operations", "Build speed", "Package installs", "Git operations"],
        expectedRange: "100-2000ms per operation",
        recommendation: "Use an SSD if not already, ensure adequate free space (20%+), or check disk health."
    },
    git: {
        label: "Git",
        description: "Git operations: init, add, commit, status, branch, diff.",
        why: "Git performance directly impacts developer workflow responsiveness.",
        affects: ["Version control", "CI/CD", "Repository operations"],
        expectedRange: "50-500ms per operation",
        recommendation: "Run 'git gc' on large repos, ensure adequate disk speed, or check for large files."
    },
    node: {
        label: "Node.js",
        description: "Node.js startup time and module loading speed.",
        why: "Node.js startup affects every npm script, build tool, and CLI tool invocation.",
        affects: ["Build tools", "CLI tools", "npm scripts", "Dev servers"],
        expectedRange: "50-200ms",
        recommendation: "Update Node.js to latest LTS, use 'node --no-warnings' for scripts, or check for heavy startup hooks."
    },
    shell: {
        label: "Terminal",
        description: "Shell startup and profile sourcing speed.",
        why: "Shell performance affects every terminal command and script execution.",
        affects: ["Terminal responsiveness", "Script execution", "Build pipelines"],
        expectedRange: "100-300ms",
        recommendation: "Simplify shell profile (.zshrc/.bashrc), remove slow plugins, or use a faster shell."
    },
    docker: {
        label: "Docker",
        description: "Docker daemon responsiveness, image inspection, and container startup.",
        why: "Docker performance impacts containerized development and CI/CD pipelines.",
        affects: ["Containerized dev", "CI/CD", "Local services"],
        expectedRange: "500-5000ms",
        recommendation: "Allocate more resources to Docker, use lighter base images, or clean up unused images."
    },
    flutter: {
        label: "Flutter",
        description: "Flutter doctor and pub get performance.",
        why: "Flutter performance affects mobile and cross-platform development workflows.",
        affects: ["Mobile development", "Cross-platform builds"],
        expectedRange: "2000-10000ms",
        recommendation: "Run 'flutter clean', update Flutter SDK, or check for network issues with pub."
    },
    python: {
        label: "Python",
        description: "Python startup, venv creation, and pip install speed.",
        why: "Python performance affects scripting, ML workflows, and backend development.",
        affects: ["Scripting", "ML/AI", "Backend dev", "Virtual environments"],
        expectedRange: "50-10000ms",
        recommendation: "Use pyenv for faster startup, cache pip packages, or use uv for faster installs."
    },
    databases: {
        label: "Databases",
        description: "Database connection and query responsiveness for PostgreSQL, MySQL, Redis.",
        why: "Database performance affects backend development and testing.",
        affects: ["Backend dev", "Database testing", "Local services"],
        expectedRange: "100-500ms",
        recommendation: "Ensure database services are running, check connection pooling, or use lighter alternatives for local dev."
    },
    packageManagers: {
        label: "Package Managers",
        description: "Package manager responsiveness for brew, npm, pnpm, bun.",
        why: "Package manager speed affects install times and development iteration speed.",
        affects: ["Package installs", "Dependency updates", "CI/CD"],
        expectedRange: "200-2000ms",
        recommendation: "Use faster package managers (pnpm/bun for Node, uv for Python), enable caching, or clean up old packages."
    },
    projectGeneration: {
        label: "Project Generation",
        description: "Time to scaffold new projects using DevForgeKit generators.",
        why: "Project generation speed affects developer onboarding and prototyping.",
        affects: ["Project scaffolding", "Prototyping", "Onboarding"],
        expectedRange: "5000-30000ms",
        recommendation: "Use faster generators, skip optional dependencies, or pre-cache template files."
    }
};

const BENCHMARKS = {
    cpu: { run: benchmarkCPU, label: "CPU", metadata: BENCHMARK_METADATA.cpu },
    memory: { run: benchmarkMemory, label: "Memory", metadata: BENCHMARK_METADATA.memory },
    disk: { run: benchmarkDisk, label: "Disk", metadata: BENCHMARK_METADATA.disk },
    git: { run: benchmarkGit, label: "Git", metadata: BENCHMARK_METADATA.git },
    node: { run: benchmarkNode, label: "Node.js", metadata: BENCHMARK_METADATA.node },
    shell: { run: benchmarkShell, label: "Terminal", metadata: BENCHMARK_METADATA.shell },
    docker: { run: benchmarkDocker, label: "Docker", metadata: BENCHMARK_METADATA.docker },
    flutter: { run: benchmarkFlutter, label: "Flutter", metadata: BENCHMARK_METADATA.flutter },
    python: { run: benchmarkPython, label: "Python", metadata: BENCHMARK_METADATA.python },
    databases: { run: benchmarkDatabases, label: "Databases", metadata: BENCHMARK_METADATA.databases },
    packageManagers: { run: benchmarkPackageManagers, label: "Package Managers", metadata: BENCHMARK_METADATA.packageManagers },
    projectGeneration: { run: benchmarkProjectGeneration, label: "Project Generation", metadata: BENCHMARK_METADATA.projectGeneration }
};

// ─── Machine Info ─────────────────────────────────────────────────────

async function gatherMachineInfo() {
    const cpuInfo = cpus();
    const cpuModel = cpuInfo.length > 0 ? cpuInfo[0].model : "unknown";
    const cpuCount = cpuInfo.length;
    const totalMemGb = Math.round(totalmem() / 1024 / 1024 / 1024);
    const freeMemGb = Math.round(freemem() / 1024 / 1024 / 1024);

    let osName = "unknown";
    let osVersion = "unknown";
    try {
        const { stdout } = await captureShellCommand("sw_vers 2>/dev/null");
        for (const line of stdout.split("\n")) {
            const m = /^([^:]+):\s*(.*)$/.exec(line.trim());
            if (m) {
                if (m[1].trim() === "ProductName") osName = m[2].trim();
                if (m[1].trim() === "ProductVersion") osVersion = m[2].trim();
            }
        }
    } catch {
        // Non-macOS
    }

    let machineModel = "unknown";
    try {
        const { stdout } = await captureShellCommand("system_profiler SPHardwareDataType 2>/dev/null");
        const line = stdout.split("\n").find((l) => l.includes("Model Name:"));
        if (line) machineModel = line.split("Model Name:")[1].trim();
    } catch {
        // Non-macOS
    }

    return {
        hostname: hostname(),
        os: `${osName} ${osVersion}`,
        arch: arch(),
        cpuModel,
        cpuCount,
        totalMemoryGb: totalMemGb,
        freeMemoryGb: freeMemGb,
        machineModel
    };
}

// ─── Run Benchmark ────────────────────────────────────────────────────

export async function runBenchmark({ profile = "quick", onProgress, signal, silent = false } = {}) {
    const log = silent ? { section() {}, info() {}, success() {}, warn() {} } : logger;
    const categories = PROFILES[profile];
    if (!categories) {
        throw new DevForgeError(`Unknown benchmark profile '${profile}'. Available: ${Object.keys(PROFILES).join(", ")}`);
    }

    const startTime = Date.now();
    const createdAt = new Date().toISOString();
    const id = makeBenchmarkId(createdAt);

    log.section(`Benchmark: ${profile.toUpperCase()}`);
    log.info(`Running ${categories.length} category benchmarks...\n`);

    const machine = await gatherMachineInfo();
    const categoryResults = {};
    const categoryScores = {};
    const skipped = [];

    for (let i = 0; i < categories.length; i++) {
        const catKey = categories[i];
        const bench = BENCHMARKS[catKey];
        if (!bench) continue;

        if (signal?.aborted) {
            log.warn("Benchmark cancelled");
            break;
        }

        if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "running" });

        try {
            const measurements = await bench.run();

            // Check if skipped
            if (measurements.skipped) {
                skipped.push({ category: catKey, reason: measurements.skipped });
                if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "skipped" });
                log.warn(`  ${bench.label}: skipped (${measurements.skipped})`);
                continue;
            }

            categoryResults[catKey] = measurements;
            const score = scoreCategory(measurements);
            if (score != null) {
                categoryScores[catKey] = score;
                const grade = gradeForScore(score);
                log.success(`  ${bench.label}: ${score}/100 (${grade})`);
            } else {
                log.warn(`  ${bench.label}: no valid measurements`);
            }

            if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "done", score });
        } catch (err) {
            skipped.push({ category: catKey, reason: err.message });
            if (onProgress) onProgress({ category: catKey, label: bench.label, index: i, total: categories.length, status: "error", error: err.message });
            log.warn(`  ${bench.label}: error - ${err.message}`);
        }
    }

    const overallScore = computeOverall(categoryScores);
    const overallGrade = gradeForScore(overallScore);
    const durationMs = Date.now() - startTime;

    log.section("Benchmark Complete");
    log.success(`Overall Score: ${overallScore}/100 (${overallGrade})`);
    log.info(`Duration: ${(durationMs / 1000).toFixed(1)}s`);
    if (skipped.length > 0) {
        log.warn(`Skipped: ${skipped.length} category(ies)`);
    }

    // Find slowest and fastest categories
    const scoredEntries = Object.entries(categoryScores).filter(([, s]) => s != null);
    let slowest = null;
    let fastest = null;
    if (scoredEntries.length > 0) {
        scoredEntries.sort((a, b) => a[1] - b[1]);
        slowest = { category: scoredEntries[0][0], score: scoredEntries[0][1] };
        fastest = { category: scoredEntries[scoredEntries.length - 1][0], score: scoredEntries[scoredEntries.length - 1][1] };
    }

    // Compatibility check. Bounded concurrency (same worker pool
    // doctor.js/componentManager.js/packageIntel.js use) instead of a
    // plain sequential loop - validating all 261 packages one at a time
    // here was the same class of ~50-80s bottleneck fixed elsewhere.
    let compatibilityIssues = [];
    try {
        const validated = await mapWithConcurrency(loadPackages(), 8, async (pkg) => {
            if (!pkg.validate) return null;
            try {
                return (await validate(pkg)) === 0 ? pkg.name : null;
            } catch {
                return null;
            }
        });
        const installed = validated.filter(Boolean);
        const compatResult = await scanCompatibility(installed);
        compatibilityIssues = (compatResult.issues || []).filter((i) => i.severity === "FAIL" || i.severity === "WARNING");
    } catch {
        // Non-critical
    }

    // Phase 2: Rich metadata — category labels, affected packages, environment
    const categoryLabels = {};
    const affectedPackages = {};
    const confidenceData = {};
    for (const catKey of Object.keys(categoryResults)) {
        const bench = BENCHMARKS[catKey];
        categoryLabels[catKey] = bench?.label || catKey;
        // Collect affected packages from metadata
        if (bench?.metadata?.affects) {
            affectedPackages[catKey] = bench.metadata.affects;
        }
        // Collect confidence/variance from multi-run results
        const measurements = categoryResults[catKey];
        const confidences = [];
        for (const [, val] of Object.entries(measurements)) {
            if (typeof val === "object" && val?.confidence != null) {
                confidences.push(val.confidence);
            }
        }
        if (confidences.length > 0) {
            confidenceData[catKey] = {
                avgConfidence: Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length * 100) / 100,
                runs: confidences.length
            };
        }
    }

    // Phase 2: Environment details
    let nodeVersion = "unknown";
    let shellType = "unknown";
    try { nodeVersion = process.version; } catch { /* ignore */ }
    try { shellType = process.env.SHELL?.split("/").pop() || "unknown"; } catch { /* ignore */ }

    // Phase 8: Benchmark quality score
    const qualityScore = computeBenchmarkQuality({
        totalCategories: categories.length,
        runCategories: Object.keys(categoryScores).length,
        skipped: skipped.length,
        confidenceData
    });

    const result = {
        benchmarkVersion: BENCHMARK_VERSION,
        id,
        createdAt,
        profile,
        durationMs,
        devforgekitVersion: getVersion(),
        machine,
        environment: { nodeVersion, shellType, platform: currentPlatform()?.id || "unknown", arch: currentArchitecture() || arch() },
        categoryResults,
        categoryScores,
        categoryLabels,
        affectedPackages,
        confidence: confidenceData,
        overallScore,
        overallGrade,
        slowest,
        fastest,
        skipped,
        compatibilityIssues,
        qualityScore
    };

    return result;
}

// ─── Save Result ──────────────────────────────────────────────────────

export function saveResult(result) {
    const dir = benchmarksDir();
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${result.id}.json`);
    writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`);
    return filePath;
}

// ─── List History ─────────────────────────────────────────────────────

export function listHistory({ filter, search, limit, sortBy = "date", sortOrder = "desc" } = {}) {
    const dir = benchmarksDir();
    if (!existsSync(dir)) return [];

    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = path.join(dir, entry.name);
        try {
            const data = JSON.parse(readFileSync(filePath, "utf8"));
            results.push({
                id: data.id,
                createdAt: data.createdAt,
                profile: data.profile,
                overallScore: data.overallScore,
                overallGrade: data.overallGrade,
                durationMs: data.durationMs,
                machine: data.machine?.hostname || "unknown",
                os: data.machine?.os || "unknown",
                qualityScore: data.qualityScore || null,
                categoryScores: data.categoryScores || {},
                path: filePath
            });
        } catch {
            // Corrupt file - skip
        }
    }

    // Phase 9: Filter by profile, grade, or score range
    let filtered = results;
    if (filter) {
        if (filter.profile) filtered = filtered.filter((r) => r.profile === filter.profile);
        if (filter.grade) filtered = filtered.filter((r) => r.overallGrade === filter.grade);
        if (filter.minScore != null) filtered = filtered.filter((r) => r.overallScore >= filter.minScore);
        if (filter.maxScore != null) filtered = filtered.filter((r) => r.overallScore <= filter.maxScore);
    }

    // Phase 9: Search across id, machine, profile
    if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter((r) =>
            r.id.toLowerCase().includes(q) ||
            r.machine.toLowerCase().includes(q) ||
            r.profile.toLowerCase().includes(q) ||
            r.os.toLowerCase().includes(q)
        );
    }

    // Sort
    const sortKey = sortBy === "score" ? "overallScore" : sortBy === "duration" ? "durationMs" : "createdAt";
    filtered.sort((a, b) => {
        const aVal = a[sortKey] || 0;
        const bVal = b[sortKey] || 0;
        if (sortKey === "createdAt") {
            return sortOrder === "desc" ? (aVal < bVal ? 1 : aVal > bVal ? -1 : 0)
                : (aVal > bVal ? 1 : aVal < bVal ? -1 : 0);
        }
        return sortOrder === "desc" ? bVal - aVal : aVal - bVal;
    });

    // Limit
    if (limit && limit > 0) {
        filtered = filtered.slice(0, limit);
    }

    return filtered;
}

// ─── Get Result ───────────────────────────────────────────────────────

export function getResult(id) {
    const filePath = path.join(benchmarksDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Benchmark result '${id}' not found`);
    }
    return JSON.parse(readFileSync(filePath, "utf8"));
}

// ─── Delete Result ────────────────────────────────────────────────────

export function deleteResult(id) {
    const filePath = path.join(benchmarksDir(), `${id}.json`);
    if (!existsSync(filePath)) {
        throw new DevForgeError(`Benchmark result '${id}' not found`);
    }
    rmSync(filePath, { force: true });
    return filePath;
}

// ─── Compare Results ──────────────────────────────────────────────────

export function compareResults(oldResult, newResult) {
    const allCategories = new Set([
        ...Object.keys(oldResult.categoryScores || {}),
        ...Object.keys(newResult.categoryScores || {})
    ]);

    const categories = [];
    for (const cat of allCategories) {
        const oldScore = oldResult.categoryScores?.[cat] ?? null;
        const newScore = newResult.categoryScores?.[cat] ?? null;
        const delta = (oldScore != null && newScore != null) ? newScore - oldScore : null;
        const status = delta == null ? "N/A" : delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";

        // Phase 4: Significance and likely cause
        let significant = false;
        if (oldScore != null && newScore != null && oldScore > 0) {
            significant = Math.abs(delta) / oldScore >= SIGNIFICANCE_THRESHOLD;
        }

        const label = BENCHMARKS[cat]?.label || cat;
        const metadata = BENCHMARKS[cat]?.metadata;
        let likelyCause = null;
        let recommendation = null;
        if (significant && status === "regressed" && metadata) {
            likelyCause = inferCause(cat, oldResult, newResult);
            recommendation = metadata.recommendation;
        }
        if (significant && status === "improved" && metadata) {
            recommendation = `Improvement in ${label}. Keep up whatever changed.`;
        }

        // Phase 4: Measurement-level comparison
        const oldMeasurements = oldResult.categoryResults?.[cat] || {};
        const newMeasurements = newResult.categoryResults?.[cat] || {};
        const measurementDeltas = [];
        for (const mKey of new Set([...Object.keys(oldMeasurements), ...Object.keys(newMeasurements)])) {
            const oldMs = oldMeasurements[mKey];
            const newMs = newMeasurements[mKey];
            if (typeof oldMs === "number" && typeof newMs === "number") {
                const mDelta = newMs - oldMs;
                const mPct = oldMs > 0 ? Math.round((mDelta / oldMs) * 100) : 0;
                measurementDeltas.push({ measurement: mKey, oldMs, newMs, delta: mDelta, pct: mPct, faster: mDelta < 0 });
            }
        }

        categories.push({
            category: cat, label,
            oldScore, newScore, delta, status, significant,
            likelyCause, recommendation,
            measurementDeltas
        });
    }

    const overallDelta = (oldResult.overallScore != null && newResult.overallScore != null)
        ? newResult.overallScore - oldResult.overallScore
        : null;

    // Phase 4: Summary counts
    const improved = categories.filter((c) => c.status === "improved");
    const regressed = categories.filter((c) => c.status === "regressed");
    const unchanged = categories.filter((c) => c.status === "unchanged");
    const significantChanges = categories.filter((c) => c.significant);

    return {
        old: {
            id: oldResult.id,
            createdAt: oldResult.createdAt,
            overallScore: oldResult.overallScore,
            overallGrade: oldResult.overallGrade,
            machine: oldResult.machine?.hostname
        },
        new: {
            id: newResult.id,
            createdAt: newResult.createdAt,
            overallScore: newResult.overallScore,
            overallGrade: newResult.overallGrade,
            machine: newResult.machine?.hostname
        },
        overallDelta,
        summary: {
            improved: improved.length,
            regressed: regressed.length,
            unchanged: unchanged.length,
            significant: significantChanges.length
        },
        categories: categories.sort((a, b) => {
            if (a.delta == null && b.delta == null) return 0;
            if (a.delta == null) return 1;
            if (b.delta == null) return -1;
            return b.delta - a.delta;
        })
    };
}

// inferCause — attempts to identify the likely cause of a regression
function inferCause(category, oldResult, newResult) {
    const oldMachine = oldResult.machine || {};
    const newMachine = newResult.machine || {};

    // Machine changed
    if (oldMachine.hostname !== newMachine.hostname) {
        return `Different machine (${oldMachine.hostname} → ${newMachine.hostname})`;
    }

    // Free memory dropped significantly
    if (oldMachine.freeMemoryGb != null && newMachine.freeMemoryGb != null) {
        const memDiff = newMachine.freeMemoryGb - oldMachine.freeMemoryGb;
        if (memDiff < -4) {
            return `Free RAM decreased by ${Math.abs(memDiff)}GB — background processes may be consuming memory`;
        }
    }

    // OS version changed
    if (oldMachine.os !== newMachine.os) {
        return `OS updated (${oldMachine.os} → ${newMachine.os})`;
    }

    // Category-specific causes
    const causes = {
        cpu: "Background processes or thermal throttling",
        memory: "Memory pressure from other applications",
        disk: "Disk nearly full, background I/O, or disk health degradation",
        git: "Repository grew or disk I/O degraded",
        node: "Node.js version changed or startup hooks added",
        shell: "Shell profile modified or plugins added",
        docker: "Docker resource allocation changed or images accumulated",
        flutter: "Flutter SDK updated or network latency with pub",
        python: "Python version changed or pip cache cleared",
        databases: "Database load increased or connection pool exhausted",
        packageManagers: "Package manager cache cleared or registry latency",
        projectGeneration: "Generator templates changed or network latency"
    };
    return causes[category] || "Unknown cause — check for system changes";
}

// ─── Export Result ────────────────────────────────────────────────────

export function exportResult(result, format) {
    switch (format) {
        case "json":
            return exportJSON(result);
        case "markdown":
        case "md":
            return exportMarkdown(result);
        case "html":
            return exportHTML(result);
        case "csv":
            return exportCSV(result);
        default:
            throw new DevForgeError(`Unknown export format '${format}'. Available: json, markdown, html, csv`);
    }
}

function exportJSON(result) {
    return `${JSON.stringify(result, null, 2)}\n`;
}

function exportMarkdown(result) {
    const lines = [
        `# Benchmark Report`,
        ``,
        `**Date:** ${result.createdAt}`,
        `**Profile:** ${result.profile}`,
        `**Machine:** ${result.machine?.hostname || "unknown"} (${result.machine?.os || "unknown"})`,
        `**DevForgeKit:** ${result.devforgekitVersion}`,
        `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
        ``,
        `## Overall Score`,
        ``,
        `**${result.overallScore}/100** (Grade: ${result.overallGrade})`,
        ``,
        `## Category Scores`,
        ``,
        `| Category | Score | Grade |`,
        `|----------|-------|-------|`
    ];

    for (const [cat, score] of Object.entries(result.categoryScores || {})) {
        if (score == null) continue;
        const label = BENCHMARKS[cat]?.label || cat;
        const grade = gradeForScore(score);
        lines.push(`| ${label} | ${score} | ${grade} |`);
    }

    if (result.slowest) {
        lines.push(``, `**Slowest:** ${BENCHMARKS[result.slowest.category]?.label || result.slowest.category} (${result.slowest.score})`);
    }
    if (result.fastest) {
        lines.push(`**Fastest:** ${BENCHMARKS[result.fastest.category]?.label || result.fastest.category} (${result.fastest.score})`);
    }

    if (result.skipped?.length > 0) {
        lines.push(``, `## Skipped Categories`, ``);
        for (const s of result.skipped) {
            lines.push(`- **${BENCHMARKS[s.category]?.label || s.category}**: ${s.reason}`);
        }
    }

    if (result.compatibilityIssues?.length > 0) {
        lines.push(``, `## Compatibility Issues`, ``);
        for (const issue of result.compatibilityIssues) {
            lines.push(`- **[${issue.severity}]** ${issue.tool}: ${issue.message}`);
        }
    }

    lines.push(``, `## Detailed Measurements`, ``);
    for (const [cat, measurements] of Object.entries(result.categoryResults || {})) {
        const label = BENCHMARKS[cat]?.label || cat;
        lines.push(`### ${label}`, ``);
        for (const [name, ms] of Object.entries(measurements)) {
            if (ms == null) continue;
            lines.push(`- ${name}: ${ms}ms`);
        }
        lines.push(``);
    }

    return lines.join("\n");
}

function exportHTML(result) {
    const rows = Object.entries(result.categoryScores || {})
        .filter(([, s]) => s != null)
        .map(([cat, score]) => {
            const label = BENCHMARKS[cat]?.label || cat;
            const grade = gradeForScore(score);
            const color = score >= 80 ? "#4caf50" : score >= 60 ? "#ff9800" : "#f44336";
            return `    <tr><td>${label}</td><td style="color:${color}">${score}</td><td>${grade}</td></tr>`;
        })
        .join("\n");

    const measurements = Object.entries(result.categoryResults || {})
        .map(([cat, measurements]) => {
            const label = BENCHMARKS[cat]?.label || cat;
            const items = Object.entries(measurements)
                .filter(([, ms]) => ms != null)
                .map(([name, ms]) => `<li>${name}: ${ms}ms</li>`)
                .join("");
            return `    <h3>${label}</h3>\n    <ul>${items}</ul>`;
        })
        .join("\n");

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Benchmark Report - ${result.id}</title>
  <style>
    body { font-family: -apple-system, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a1a1a; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    th { background: #f5f5f5; }
    .score { font-size: 2em; font-weight: bold; }
    .grade { font-size: 1.5em; }
  </style>
</head>
<body>
  <h1>Benchmark Report</h1>
  <p><strong>Date:</strong> ${result.createdAt}<br>
  <strong>Profile:</strong> ${result.profile}<br>
  <strong>Machine:</strong> ${result.machine?.hostname || "unknown"} (${result.machine?.os || "unknown"})<br>
  <strong>DevForgeKit:</strong> ${result.devforgekitVersion}<br>
  <strong>Duration:</strong> ${(result.durationMs / 1000).toFixed(1)}s</p>

  <h2>Overall Score</h2>
  <p class="score">${result.overallScore}/100</p>
  <p class="grade">Grade: ${result.overallGrade}</p>

  <h2>Category Scores</h2>
  <table>
    <tr><th>Category</th><th>Score</th><th>Grade</th></tr>
${rows}
  </table>

  <h2>Detailed Measurements</h2>
${measurements}
</body>
</html>
`;
}

function exportCSV(result) {
    const lines = ["category,measurement,duration_ms,score"];
    for (const [cat, measurements] of Object.entries(result.categoryResults || {})) {
        const score = result.categoryScores?.[cat] ?? "";
        for (const [name, ms] of Object.entries(measurements)) {
            if (ms == null) continue;
            lines.push(`${cat},${name},${ms},${score}`);
        }
    }
    lines.push(`,overall,${result.durationMs},${result.overallScore}`);
    return lines.join("\n") + "\n";
}

// ─── Explain (AI) ─────────────────────────────────────────────────────

export async function explainResult(result, { provider, model, endpoint } = {}) {
    const { loadConfig } = await import("./config.js");
    const { getProvider, resolveApiKey } = await import("./ai/providers/index.js");
    const { getActiveWorkspace } = await import("./workspace/store.js");
    const { buildPrompt } = await import("./ai/prompts/library.js");

    const config = loadConfig();
    const providerId = provider || (config.aiProvider && config.aiProvider !== "none" ? config.aiProvider : null);

    if (!providerId) {
        return {
            ok: false,
            error: "No AI provider configured. Run 'devforgekit config set aiProvider <provider>' or pass --provider."
        };
    }

    const workspace = getActiveWorkspace();
    const opts = {
        apiKey: resolveApiKey(providerId, { workspace }),
        model: model || config.aiModel || undefined,
        endpoint: endpoint || config.aiEndpoint || undefined,
        workspace
    };

    const aiProvider = getProvider(providerId, opts);

    // Build context from benchmark data
    const context = {
        machine: result.machine,
        overallScore: result.overallScore,
        overallGrade: result.overallGrade,
        categoryScores: result.categoryScores,
        categoryResults: result.categoryResults,
        slowest: result.slowest,
        fastest: result.fastest,
        skipped: result.skipped,
        compatibilityIssues: result.compatibilityIssues,
        profile: result.profile,
        durationMs: result.durationMs
    };

    const prompt = buildPrompt("explain", context, `Explain this DevForgeKit benchmark result. Identify slow categories, performance bottlenecks, and recommend concrete upgrades, configuration improvements, and toolchain optimizations. Only use the measured benchmark data in the context - never invent recommendations. The benchmark was run on ${result.machine?.hostname} with profile ${result.profile}.`);

    const response = await aiProvider.chat(prompt);
    return { ok: true, explanation: response.content };
}

// ─── Benchmark Summary for Snapshots ──────────────────────────────────

export function benchmarkSummary(result) {
    return {
        id: result.id,
        createdAt: result.createdAt,
        profile: result.profile,
        overallScore: result.overallScore,
        overallGrade: result.overallGrade,
        categoryScores: result.categoryScores,
        slowest: result.slowest,
        fastest: result.fastest
    };
}

// ─── Phase 5: Trend Analysis ──────────────────────────────────────────
// Returns a trend series for a specific category (or overall) across
// benchmark history. Useful for sparklines and degradation detection.

export function getTrend(category, { limit = 20 } = {}) {
    const history = listHistory({ limit, sortBy: "date", sortOrder: "asc" });
    const points = [];
    for (const h of history) {
        if (category === "overall") {
            points.push({
                id: h.id,
                createdAt: h.createdAt,
                score: h.overallScore,
                grade: h.overallGrade
            });
        } else {
            const score = h.categoryScores?.[category];
            if (score != null) {
                points.push({
                    id: h.id,
                    createdAt: h.createdAt,
                    score,
                    grade: gradeForScore(score)
                });
            }
        }
    }
    return { category, points, count: points.length };
}

// renderSparkline — produces an ASCII sparkline from an array of scores.
// Returns a string like "▁▂▃▄▅▆▇█" scaled to the data range.
export function renderSparkline(values, { width = 20 } = {}) {
    if (!values || values.length === 0) return "";
    const bars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    // Downsample or upsample to target width
    const result = [];
    const step = values.length / width;
    for (let i = 0; i < width; i++) {
        const idx = Math.floor(i * step);
        const v = values[Math.min(idx, values.length - 1)];
        const normalized = (v - min) / range;
        const barIdx = Math.min(bars.length - 1, Math.floor(normalized * bars.length));
        result.push(bars[barIdx]);
    }
    return result.join("");
}

// getTrendSummary — returns a human-readable trend summary for a category
export function getTrendSummary(category, { limit = 10 } = {}) {
    const trend = getTrend(category, { limit });
    if (trend.count < 2) {
        return { category, trend: "insufficient data", points: trend.points };
    }
    const scores = trend.points.map((p) => p.score);
    const first = scores[0];
    const last = scores[scores.length - 1];
    const delta = last - first;
    const sparkline = renderSparkline(scores);

    let direction;
    if (delta > 5) direction = "improving";
    else if (delta < -5) direction = "declining";
    else direction = "stable";

    // Check for volatility
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const volatility = Math.round(
        Math.sqrt(scores.reduce((acc, s) => acc + Math.pow(s - avg, 2), 0) / scores.length)
    );

    return {
        category,
        direction,
        delta,
        sparkline,
        first,
        last,
        avg: Math.round(avg),
        volatility,
        points: trend.points
    };
}

// ─── Phase 6: Benchmark Intelligence ──────────────────────────────────
// Self-explaining benchmarks — Why/Matters/Expected/Affects/Action

export function explainBenchmark(category, result) {
    const metadata = BENCHMARK_METADATA[category];
    if (!metadata) {
        return `Unknown category: ${category}`;
    }

    const score = result?.categoryScores?.[category];
    const grade = score != null ? gradeForScore(score) : "N/A";
    const measurements = result?.categoryResults?.[category] || {};
    const confidence = result?.confidence?.[category];

    const lines = [];
    lines.push(`${metadata.label}`);
    lines.push("=".repeat(metadata.label.length));
    lines.push("");
    lines.push(`Description`);
    lines.push(`  ${metadata.description}`);
    lines.push("");
    lines.push(`Why it matters`);
    lines.push(`  ${metadata.why}`);
    lines.push("");
    lines.push(`Score: ${score != null ? score + "/100" : "N/A"} (${grade})`);
    if (confidence) {
        lines.push(`Confidence: ${Math.round(confidence.avgConfidence * 100)}% (${confidence.runs} runs)`);
    }
    lines.push(`Expected range: ${metadata.expectedRange}`);
    lines.push("");

    // Measurement details
    const measurementEntries = Object.entries(measurements).filter(([, v]) => typeof v === "number" || (typeof v === "object" && v?.median != null));
    if (measurementEntries.length > 0) {
        lines.push(`Measurements:`);
        for (const [name, val] of measurementEntries) {
            if (typeof val === "number") {
                lines.push(`  ${name}: ${val}ms`);
            } else if (typeof val === "object" && val.median != null) {
                lines.push(`  ${name}: ${val.median}ms (±${val.variance}ms, confidence: ${Math.round(val.confidence * 100)}%)`);
            }
        }
        lines.push("");
    }

    lines.push(`What affects it`);
    for (const a of metadata.affects) {
        lines.push(`  • ${a}`);
    }
    lines.push("");

    if (score != null && score < 70) {
        lines.push(`Recommendation`);
        lines.push(`  ${metadata.recommendation}`);
    } else if (score != null && score >= 90) {
        lines.push(`Status: Excellent — no action needed.`);
    } else if (score != null) {
        lines.push(`Status: Acceptable — monitor for changes.`);
    }

    return lines.join("\n");
}

export function explainBenchmarkResult(result) {
    const lines = [];
    lines.push("Benchmark Intelligence Report");
    lines.push("=".repeat(35));
    lines.push("");
    lines.push(`Overall Score: ${result.overallScore}/100 (${result.overallGrade})`);
    lines.push(`Profile: ${result.profile}`);
    lines.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
    if (result.machine) {
        lines.push(`Machine: ${result.machine.hostname} — ${result.machine.os}`);
        lines.push(`CPU: ${result.machine.cpuModel} (${result.machine.cpuCount} cores)`);
        lines.push(`RAM: ${result.machine.totalMemoryGb}GB total, ${result.machine.freeMemoryGb}GB free`);
    }
    if (result.environment) {
        lines.push(`Node: ${result.environment.nodeVersion}, Shell: ${result.environment.shellType}`);
    }
    lines.push("");

    if (result.slowest) {
        const slowMeta = BENCHMARK_METADATA[result.slowest.category];
        lines.push(`Slowest: ${slowMeta?.label || result.slowest.category} (${result.slowest.score}/100)`);
    }
    if (result.fastest) {
        const fastMeta = BENCHMARK_METADATA[result.fastest.category];
        lines.push(`Fastest: ${fastMeta?.label || result.fastest.category} (${result.fastest.score}/100)`);
    }
    lines.push("");

    // Per-category intelligence
    const categories = Object.keys(result.categoryScores || {});
    for (const cat of categories) {
        lines.push(explainBenchmark(cat, result));
        lines.push("");
        lines.push("-".repeat(40));
        lines.push("");
    }

    // Skipped
    if (result.skipped && result.skipped.length > 0) {
        lines.push("Skipped Categories:");
        for (const s of result.skipped) {
            lines.push(`  • ${BENCHMARK_METADATA[s.category]?.label || s.category}: ${s.reason}`);
        }
        lines.push("");
    }

    // Quality score
    if (result.qualityScore) {
        lines.push(`Benchmark Quality: ${result.qualityScore.score}/100 (${result.qualityScore.grade})`);
        lines.push(`  Coverage: ${result.qualityScore.coverage}%, Confidence: ${result.qualityScore.confidence}%`);
    }

    return lines.join("\n");
}

// ─── Phase 8: Benchmark Quality Score ─────────────────────────────────
// Scores the benchmark run itself on coverage, confidence, stability.

export function computeBenchmarkQuality({ totalCategories, runCategories, skipped, confidenceData }) {
    // Coverage: percentage of categories that produced scores
    const coverage = totalCategories > 0 ? Math.round((runCategories / totalCategories) * 100) : 0;

    // Confidence: average confidence across all categories with data
    let confidence = 100; // Default when no multi-run data (single run = assume good)
    const confValues = Object.values(confidenceData || {});
    if (confValues.length > 0) {
        confidence = Math.round(
            (confValues.reduce((acc, c) => acc + c.avgConfidence, 0) / confValues.length) * 100
        );
    }

    // Stability: penalty for skipped categories
    const skipPenalty = skipped * 5;
    const stability = Math.max(0, 100 - skipPenalty);

    // Repeatability: based on confidence (higher confidence = more repeatable)
    const repeatability = confidence;

    // Overall quality score
    const score = Math.round(
        coverage * 0.3 +
        confidence * 0.25 +
        stability * 0.25 +
        repeatability * 0.2
    );

    const grade = gradeForScore(score);

    return {
        score,
        grade,
        coverage,
        confidence,
        stability,
        repeatability,
        skippedCount: skipped
    };
}

// ─── Phase 3: Rich Report ─────────────────────────────────────────────
// Produces a rich per-measurement report with previous comparison.

export function generateRichReport(result, { previousResult } = {}) {
    const lines = [];
    lines.push(`${result.overallGrade} ${result.overallScore}/100`);
    lines.push("");

    for (const [catKey, score] of Object.entries(result.categoryScores || {})) {
        const meta = BENCHMARK_METADATA[catKey];
        const label = meta?.label || catKey;
        const grade = gradeForScore(score);
        const measurements = result.categoryResults?.[catKey] || {};

        lines.push(`${label}`);
        lines.push(`  Score: ${score}/100 (${grade})`);

        // Previous comparison
        if (previousResult) {
            const prevScore = previousResult.categoryScores?.[catKey];
            if (prevScore != null) {
                const delta = score - prevScore;
                const sign = delta > 0 ? "+" : "";
                const status = delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
                lines.push(`  Previous: ${prevScore}/100`);
                lines.push(`  Difference: ${sign}${delta} (${status})`);
            }
        }

        // Measurement details
        for (const [mName, mVal] of Object.entries(measurements)) {
            if (typeof mVal === "number") {
                const expected = EXPECTED_TIMES[catKey]?.[mName];
                const status = expected ? (mVal <= expected ? "normal" : "slow") : "N/A";
                lines.push(`  ${mName}: ${mVal}ms (${status})`);
            } else if (typeof mVal === "object" && mVal?.median != null) {
                lines.push(`  ${mName}: ${mVal.median}ms ±${mVal.variance}ms (confidence: ${Math.round(mVal.confidence * 100)}%)`);
            }
        }

        // Recommendation
        if (score < 70 && meta) {
            lines.push(`  Recommendation: ${meta.recommendation}`);
        }

        lines.push("");
    }

    return lines.join("\n");
}
