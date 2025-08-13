function isPreloading(): boolean {
    if ((module as any).isPreloading !== undefined) {
        // >=v14.17.0
        return (module as any).isPreloading;
    }

    return module.parent?.id === "internal/preload";
}

function exitError(message: string): never {
    console.error("pprof-it: " + message);
    process.exit(1);
}

if (!isPreloading()) {
    exitError("pprof-it must be required using the --require flag");
}

declare var window: any;

function isElectron() {
    if (process.versions && process.versions["electron"]) return true;
    if (process.env["ELECTRON_RUN_AS_NODE"]) return true;
    return typeof window !== "undefined" && window.process && window.process.type === "renderer";
}

let electronHack = false;
let electonVersion: string | undefined;
let electronRunAsNode: string | undefined;
let windowBackup: any;

if (isElectron()) {
    electronHack = true;
    console.error("pprof-it: Electron detected; tricking pprof into loading regular node bindings");

    if (process.versions && process.versions["electron"]) {
        electonVersion = process.versions["electron"];
        delete process.versions["electron"];
    }

    if (process.env["ELECTRON_RUN_AS_NODE"]) {
        electronRunAsNode = process.env["ELECTRON_RUN_AS_NODE"];
        delete process.env["ELECTRON_RUN_AS_NODE"];
    }

    if (typeof window !== "undefined") {
        windowBackup = window;
        delete (globalThis as any).window;
    }

    if (isElectron()) {
        exitError("pprof-it: Failed to trick pprof into loading regular node bindings");
    }
}

// The below imports are transpiled as CJS, so will be executed after the above code.

import assert = require("node:assert");
import fs = require("node:fs");
import path = require("node:path");
import worker_threads = require("node:worker_threads");

import pprof = require("@datadog/pprof");
import pprofProfileSerializer = require("@datadog/pprof/out/src/profile-serializer");
import type { TimeProfilerOptions } from "@datadog/pprof/out/src/time-profiler";
import pprofTimeProfilerBindings = require("@datadog/pprof/out/src/time-profiler-bindings");
import type { Profile } from "pprof-format";
import signalExit = require("signal-exit");

if (electronHack) {
    if (electonVersion) {
        process.versions["electron"] = electonVersion;
    }

    if (electronRunAsNode) {
        process.env["ELECTRON_RUN_AS_NODE"] = electronRunAsNode;
    }

    if (windowBackup) {
        (globalThis as any).window = windowBackup;
    }
}

enum ProfilerName {
    Heap = "heap",
    Time = "time",
}

namespace Options {
    function parseEnvInt(envName: string): number | undefined {
        const v = process.env[envName];
        if (!v) {
            return undefined;
        }

        const x = Number.parseInt(v);
        if (Number.isNaN(x)) {
            exitError(`invalid value ${envName}=${v}`);
        }
        return x;
    }

    function parseEnvBoolean(envName: string): boolean | undefined {
        const v = process.env[envName];
        if (!v) {
            return undefined;
        }

        switch (v.toLowerCase()) {
            case "1":
            case "true":
            case "yes":
            case "on":
                return true;
            case "0":
            case "false":
            case "no":
            case "off":
                return false;
            default:
                exitError(`invalid value ${envName}=${v}`);
        }
    }

    function tryStat(p: string) {
        try {
            return fs.statSync(p);
        } catch {
            return undefined;
        }
    }

    function assertExistsAndDir(p: string) {
        const stat = tryStat(p);
        if (!stat) {
            exitError(`${p} does not exist`);
        }
        if (!stat.isDirectory()) {
            exitError(`${p} is not a directory`);
        }
    }

    function parseEnvDir(envName: string): string | undefined {
        const p = process.env[envName];
        if (!p) {
            return undefined;
        }

        assertExistsAndDir(p);
        return p;
    }

    function parseOutputPath(envName: string, defaultFilename: string): string {
        const p = path.resolve(outDir, process.env[envName] || "");

        if (tryStat(p)?.isDirectory()) {
            return path.join(p, defaultFilename);
        }

        assertExistsAndDir(path.dirname(p));
        return p;
    }

    const allProfilers = new Set(Object.values(ProfilerName));
    function isProfilerName(s: string): s is ProfilerName {
        return allProfilers.has(s as any);
    }

    function parseEnvProfilers(envName: string): Set<ProfilerName> | undefined {
        const v = process.env[envName];
        if (!v) {
            return undefined;
        }

        const profilers = new Set<ProfilerName>();
        for (const x of v.split(",").filter(Boolean)) {
            if (isProfilerName(x)) {
                profilers.add(x);
            } else {
                exitError(`unknown profiler "${x}"`);
            }
        }

        return profilers.size > 0 ? profilers : undefined;
    }

    export const profilers = parseEnvProfilers("PPROF_PROFILERS") ?? allProfilers;
    export const outDir = parseEnvDir("PPROF_OUT") ?? process.cwd();
    export const sanitize = parseEnvBoolean("PPROF_SANITIZE") ?? false;
    export const lineNumbers = parseEnvBoolean("PPROF_LINE_NUMBERS") ?? true;
    export const heapOut = parseOutputPath("PPROF_HEAP_OUT", `pprof-heap-${process.pid}.pb.gz`);
    export const heapInterval = parseEnvInt("PPROF_HEAP_INTERVAL") ?? 512 * 1024;
    export const heapStackDepth = parseEnvInt("PPROF_HEAP_STACK_DEPTH") ?? 64;
    export const timeOut = parseOutputPath("PPROF_TIME_OUT", `pprof-time-${process.pid}.pb.gz`);
    export const timeInterval = parseEnvInt("PPROF_TIME_INTERVAL") ?? 1000;
    export const signalExit = parseEnvBoolean("PPROF_SIGNAL_EXIT") ?? true;
    export const logging = parseEnvBoolean("PPROF_LOGGING") ?? true;
}

function log(message: string): void {
    if (Options.logging) {
        console.error("pprof-it: " + message);
    }
}

const cwdPrefix = process.cwd() + path.sep;

function prettierPath(p: string) {
    if (p.startsWith(cwdPrefix)) {
        return p.slice(cwdPrefix.length);
    }
    return p;
}

function assertNever(x: never): never {
    throw new Error(`Unexpected object: ${x}`);
}

const sanitizedNames = new Map<string, string>();
function sanitize(s: string): string {
    let sanitized = sanitizedNames.get(s);
    if (sanitized === undefined) {
        sanitized = `SANITIZED_${sanitizedNames.size}`;
        log(`Sanitizing "${s}" to "${sanitized}"`);
        sanitizedNames.set(s, sanitized);
    }
    return sanitized;
}

abstract class Profiler {
    private _profile?: Profile;

    constructor(private _name: ProfilerName, private _profilePath: string) {}

    abstract start(): void;

    protected abstract _stop(): Profile;

    stop(): void {
        this._profile = this._stop();
    }

    sanitize(): void {
        assert.ok(this._profile);

        const ids = new Set<number>();

        // All samples/locations are rooted at functions, which contain
        // the string IDs of the filename.
        assert.ok(this._profile.function);
        for (const f of this._profile.function) {
            const filename = f.filename;
            if (filename) {
                if (typeof filename === "number") {
                    ids.add(filename);
                } else {
                    throw new TypeError(`unsupported filename ${filename}`);
                }
            }
        }

        assert.ok(this._profile.stringTable);
        for (const index of ids.values()) {
            const p = this._profile.stringTable.strings[index];
            // Paths to the parts of the standard library that are implemented
            // in JavaScript are relative; other paths are absolute.
            if (p && path.isAbsolute(p)) {
                this._profile.stringTable.strings[index] = sanitize(p);
            }
        }
    }

    write(): void {
        assert.ok(this._profile);
        log(`Writing ${this._name} profile to ${prettierPath(this._profilePath)}`);
        const buffer = pprof.encodeSync(this._profile);
        fs.writeFileSync(this._profilePath, buffer);
    }
}

class HeapProfiler extends Profiler {
    constructor() {
        super(ProfilerName.Heap, Options.heapOut);
    }

    start(): void {
        pprof.heap.start(Options.heapInterval, Options.heapStackDepth);
    }

    protected _stop(): Profile {
        return pprof.heap.profile();
    }
}

const DEFAULT_INTERVAL_MICROS = 1000;
const DEFAULT_DURATION_MILLIS = 60_000;

const DEFAULT_OPTIONS: TimeProfilerOptions = {
    durationMillis: DEFAULT_DURATION_MILLIS,
    intervalMicros: DEFAULT_INTERVAL_MICROS,
    lineNumbers: false,
    withContexts: false,
    workaroundV8Bug: true,
    collectCpuTime: false,
    collectAsyncId: false,
    useCPED: false,
};

class TimeProfiler extends Profiler {
    private _timeProfiler: typeof pprofTimeProfilerBindings.TimeProfiler;

    constructor() {
        super(ProfilerName.Time, Options.timeOut);
    }

    start(): void {
        const options: TimeProfilerOptions = {
            ...DEFAULT_OPTIONS,
            intervalMicros: Options.timeInterval,
            lineNumbers: Options.lineNumbers,
        };

        this._timeProfiler = new pprofTimeProfilerBindings.TimeProfiler({
            ...options,
            isMainThread: worker_threads.isMainThread,
        });
        this._timeProfiler.start();
    }

    protected _stop(): Profile {
        const profile = this._timeProfiler.stop(false);

        const serialized_profile = pprofProfileSerializer.serializeTimeProfile(
            profile,
            Options.timeInterval,
            /*gSourceMapper*/ undefined,
            true,
            /*generateLabels*/ undefined,
        );

        return serialized_profile;
    }
}

function onExit(fn: () => void) {
    if (Options.signalExit) {
        signalExit.onExit(fn);
    } else {
        process.on("exit", fn);
    }
}

const profilers: Profiler[] = [];

for (const x of Options.profilers) {
    switch (x) {
        case ProfilerName.Heap:
            profilers.push(new HeapProfiler());
            break;
        case ProfilerName.Time:
            profilers.push(new TimeProfiler());
            break;
        default:
            assertNever(x);
    }
}

if (profilers.length > 0) {
    log(`Starting profilers (${[...Options.profilers.values()].join(", ")})`);
    for (const p of profilers) {
        p.start();
    }

    onExit(() => {
        log(`Stopping profilers`);
        for (const p of profilers) {
            p.stop();
        }

        if (Options.sanitize) {
            log("Sanitizing profiles");
            for (const p of profilers) {
                p.sanitize();
            }
        }

        for (const p of profilers) {
            p.write();
        }

        // signal-exit always forces an exit, even if there are existing listeners.
        // If we are here and Node's "handleProcessExit" handler is still present,
        // then it's not going to run and we'll exit with without having set the code
        // to "Unfinished Top-Level Await" i.e. 13.
        //
        // To work around this problem, manually set the exit code to 13 so it doesn't
        // look like the process succeeded.
        //
        // See:
        //   - https://github.com/jakebailey/pprof-it/issues/1
        //   - https://github.com/nodejs/node/blob/67660e886758ba0ab71cb6bf90745bf0212b4167/lib/internal/modules/esm/handle_process_exit.js#L8
        const exitListeners = process.listeners("exit");
        for (const listener of exitListeners) {
            if (listener.name === "handleProcessExit") {
                process.exitCode = 13;
            }
        }
    });
}
