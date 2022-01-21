import * as pprof from '@datadog/pprof';
import { perftools } from '@datadog/pprof/proto/profile';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import signalExit from 'signal-exit';

enum ProfilerName {
    Heap = 'heap',
    Time = 'time',
}

namespace Options {
    function parseEnvInt(envName: string): number | undefined {
        const v = process.env[envName];
        if (!v) {
            return undefined;
        }

        const x = parseInt(v);
        if (isNaN(x)) {
            throw new Error(`invalid value ${envName}=${v}`);
        }
        return x;
    }

    function parseEnvBoolean(envName: string): boolean | undefined {
        const v = process.env[envName];
        if (!v) {
            return undefined;
        }

        switch (v.toLowerCase()) {
            case '1':
            case 'true':
            case 'yes':
            case 'on':
                return true;
            case '0':
            case 'false':
            case 'no':
            case 'off':
                return false;
            default:
                throw new Error(`invalid value ${envName}=${v}`);
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
            throw new Error(`${p} does not exist`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`${p} is not a directory`);
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
        const p = path.resolve(outDir(), process.env[envName] || '');

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
        for (const x of v.split(',').filter((x) => x)) {
            if (isProfilerName(x)) {
                profilers.add(x);
            } else {
                throw new Error(`unknown profiler "${x}"`);
            }
        }

        return profilers.size ? profilers : undefined;
    }

    const unset = Symbol('unset');
    function lazy<T>(fn: () => T): () => T {
        let v: T | typeof unset = unset;
        return () => {
            if (v === unset) {
                v = fn();
            }
            return v;
        };
    }

    export const profilers = lazy(() => parseEnvProfilers('PPROF_PROFILERS') ?? allProfilers);
    export const outDir = lazy(() => parseEnvDir('PPROF_OUT') ?? process.cwd());
    export const sanitize = lazy(() => parseEnvBoolean('PPROF_SANITIZE') ?? false);
    export const lineNumbers = lazy(() => parseEnvBoolean('PPROF_LINE_NUMBERS') ?? true);
    export const heapOut = lazy(() => parseOutputPath('PPROF_HEAP_OUT', `pprof-heap-${process.pid}.pb.gz`));
    export const heapInterval = lazy(() => parseEnvInt('PPROF_HEAP_INTERVAL') ?? 512 * 1024);
    export const heapStackDepth = lazy(() => parseEnvInt('PPROF_HEAP_STACK_DEPTH') ?? 64);
    export const timeOut = lazy(() => parseOutputPath('PPROF_TIME_OUT', `pprof-time-${process.pid}.pb.gz`));
    export const timeInterval = lazy(() => parseEnvInt('PPROF_TIME_INTERVAL') ?? 1000);
    export const signalExit = lazy(() => parseEnvBoolean('PPROF_SIGNAL_EXIT') ?? true);
    export const logging = lazy(() => parseEnvBoolean('PPROF_LOGGING') ?? true);
}

function log(message: string): void {
    if (Options.logging()) {
        console.error('pprof-it: ' + message);
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
    throw new Error('Unexpected object: ' + x);
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
    private _profile?: perftools.profiles.IProfile;

    constructor(private _name: ProfilerName, private _profilePath: string) {}

    abstract start(): void;

    protected abstract _stop(): perftools.profiles.IProfile;

    stop(): void {
        this._profile = this._stop();
    }

    sanitize(): void {
        assert(this._profile);

        const ids = new Set<number>();

        // All samples/locations are rooted at functions, which contain
        // the string IDs of the filename.
        assert(this._profile.function);
        for (const f of this._profile.function) {
            const filename = f.filename;
            if (filename !== undefined) {
                if (typeof filename === 'number') {
                    ids.add(filename);
                } else {
                    ids.add(filename.toInt());
                }
            }
        }

        assert(this._profile.stringTable);
        for (const index of ids.values()) {
            const p = this._profile.stringTable[index];
            // Paths to the parts of the standard library that are implemented
            // in JavaScript are relative; other paths are absolute.
            if (p && path.isAbsolute(p)) {
                this._profile.stringTable[index] = sanitize(p);
            }
        }
    }

    write(): void {
        assert(this._profile);
        log(`Writing ${this._name} profile to ${prettierPath(this._profilePath)}`);
        const buffer = pprof.encodeSync(this._profile);
        fs.writeFileSync(this._profilePath, buffer);
    }
}

class HeapProfiler extends Profiler {
    constructor() {
        super(ProfilerName.Heap, Options.heapOut());
    }

    start(): void {
        pprof.heap.start(Options.heapInterval(), Options.heapStackDepth());
    }

    protected _stop(): perftools.profiles.IProfile {
        return pprof.heap.profile();
    }
}

class TimeProfiler extends Profiler {
    private _stopFn?: () => perftools.profiles.IProfile;

    constructor() {
        super(ProfilerName.Time, Options.timeOut());
    }

    start(): void {
        this._stopFn = pprof.time.start(
            Options.timeInterval(),
            /* name */ undefined,
            /* sourceMapper */ undefined,
            Options.lineNumbers()
        );
    }

    protected _stop(): perftools.profiles.IProfile {
        assert(this._stopFn);
        return this._stopFn();
    }
}

function onExit(fn: () => void): () => void {
    if (Options.signalExit()) {
        return signalExit(fn);
    } else {
        let skip = false;
        process.on('exit', () => {
            if (!skip) {
                fn();
            }
        });
        return () => {
            skip = true;
        };
    }
}

let started = false;

/**
 * Starts a pprof profile, with options set from the environment.
 * If profiling is already running, this function will throw.
 * @param stopOnExit Whether or not to register exit handlers.
 * @returns A stop function that ends the profile.
 */
export function start(stopOnExit = true): () => void {
    if (started) {
        throw new Error('pprof-it already started');
    }

    const profilers: Profiler[] = [];

    for (const x of Options.profilers()) {
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

    if (profilers.length === 0) {
        return () => {
            /* noop */
        };
    }

    log(`Starting profilers (${[...Options.profilers().values()].join(', ')})`);
    for (const p of profilers) {
        p.start();
    }

    started = true;

    let stopped = false;
    let unregisterAtExit: (() => void) | undefined;

    const stop = (calledFromExit = false) => {
        if (stopped) {
            return;
        }

        log(`Stopping profilers`);
        for (const p of profilers) {
            p.stop();
        }

        if (Options.sanitize()) {
            log('Sanitizing profiles');
            for (const p of profilers) {
                p.sanitize();
            }
        }

        for (const p of profilers) {
            p.write();
        }

        if (!calledFromExit) {
            // If we are exiting, don't bother unregistering.
            unregisterAtExit?.();
        }

        started = false;
        stopped = true;
    };

    if (stopOnExit) {
        unregisterAtExit = onExit(() => stop(/*calledFromExit*/ true));
    }

    return stop;
}

function isPreloading(): boolean {
    if ((module as any).isPreloading !== undefined) {
        // >=v14.17.0
        return (module as any).isPreloading;
    }

    return module.parent?.id === 'internal/preload';
}

if (isPreloading()) {
    try {
        onExit(start());
    } catch (e) {
        console.error('pprof-it: ' + (e as Error).message);
        process.exit(1);
    }
}
