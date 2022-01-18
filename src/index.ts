function isPreloading(): boolean {
    if ((module as any).isPreloading !== undefined) {
        // >=v14.17.0
        return (module as any).isPreloading;
    }

    return module.parent?.id === 'internal/preload';
}

function exitError(message: string): never {
    console.error('pprof-it: ' + message);
    process.exit(1);
}

if (!isPreloading()) {
    exitError('pprof-it must be required using the --require flag');
}

import * as pprof from '@datadog/pprof';
import { perftools } from '@datadog/pprof/proto/profile';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import signalExit from 'signal-exit';

const enum EnvOpt {
    Profilers = 'PPROF_PROFILERS',
    Out = 'PPROF_OUT',
    Sanitize = 'PPROF_SANITIZE',
    LineNumbers = 'PPROF_LINE_NUMBERS',
    HeapOut = 'PPROF_HEAP_OUT',
    HeapInterval = 'PPROF_HEAP_INTERVAL',
    HeapStackDepth = 'PPROF_HEAP_STACK_DEPTH',
    TimeOut = 'PPROF_TIME_OUT',
    TimeInterval = 'PPROF_TIME_INTERVAL',
    Logging = 'PPROF_LOGGING',
}

function tryStat(p: string) {
    try {
        return fs.statSync(p);
    } catch {
        return undefined;
    }
}

function parseEnvInt(envName: EnvOpt): number | undefined {
    const v = process.env[envName];
    if (!v) {
        return undefined;
    }

    const x = parseInt(v);
    if (isNaN(x)) {
        exitError(`invalid value ${envName}=${v}`);
    }
    return x;
}

function parseEnvBoolean(envName: EnvOpt): boolean | undefined {
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
            exitError(`invalid value ${envName}=${v}`);
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

function parseEnvDir(envName: EnvOpt): string | undefined {
    const p = process.env[envName];
    if (!p) {
        return undefined;
    }

    assertExistsAndDir(p);
    return p;
}

const logging = parseEnvBoolean(EnvOpt.Logging) ?? true;

function log(message: string): void {
    if (logging) {
        console.error(message);
    }
}

const outDir = parseEnvDir(EnvOpt.Out) ?? process.cwd();

function parseOutputPath(envName: EnvOpt, defaultFilename: string): string {
    const p = path.resolve(outDir, process.env[envName] || '');

    if (tryStat(p)?.isDirectory()) {
        return path.join(p, defaultFilename);
    }

    assertExistsAndDir(path.dirname(p));
    return p;
}

function parseEnvSet(envName: EnvOpt, defaultValue: string): Set<string> {
    const v = process.env[envName] || defaultValue;
    return new Set(v.split(',').filter((x) => x));
}

const cwdPrefix = process.cwd() + path.sep;

function prettierPath(p: string) {
    if (p.startsWith(cwdPrefix)) {
        return p.slice(cwdPrefix.length);
    }
    return p;
}

const sanitize = parseEnvBoolean(EnvOpt.Sanitize) ?? false;

const sanitizedNames = new Map<string, string>();

function sanitizePaths(profile: perftools.profiles.IProfile) {
    const ids = new Set<number>();

    // All samples/locations are rooted at functions, which contain
    // the string IDs of the filename.
    for (const f of profile.function ?? []) {
        const filename = f.filename;
        if (filename !== undefined) {
            if (typeof filename === 'number') {
                ids.add(filename);
            } else {
                ids.add(filename.toInt());
            }
        }
    }

    assert(profile.stringTable);
    for (const index of ids.values()) {
        const p = profile.stringTable[index];
        // Paths to the parts of the standard library that are implemented
        // in JavaScript are relative; other paths are absolute.
        if (p && path.isAbsolute(p)) {
            let sanitized = sanitizedNames.get(p);
            if (sanitized === undefined) {
                sanitized = `SANITIZED_${sanitizedNames.size}`;
                log(`Sanitizing "${p}" to "${sanitized}"`);
                sanitizedNames.set(p, sanitized);
            }
            profile.stringTable[index] = sanitized;
        }
    }
}

const lineNumbers = parseEnvBoolean(EnvOpt.LineNumbers) ?? false;

abstract class Profiler {
    private _profilePath: string;
    private _profile?: perftools.profiles.IProfile;

    constructor(pathEnvName: EnvOpt, private _name: string) {
        this._profilePath = parseOutputPath(pathEnvName, `pprof-${_name}-${process.pid}.pb.gz`);
    }

    protected abstract _start(): void;

    start(): void {
        log(`Starting ${this._name} profile`);
        this._start();
    }

    protected abstract _stop(): perftools.profiles.IProfile;

    stop(): void {
        log(`Stopping ${this._name} profile`);
        this._profile = this._stop();
    }

    write(): void {
        assert(this._profile);

        if (sanitize) {
            sanitizePaths(this._profile);
        }

        log(`Writing ${this._name} profile to ${prettierPath(this._profilePath)}`);
        const buffer = pprof.encodeSync(this._profile);
        fs.writeFileSync(this._profilePath, buffer);
    }
}

class HeapProfiler extends Profiler {
    private _heapIntervalBytes: number;
    private _heapStackDepth: number;

    constructor() {
        super(EnvOpt.HeapOut, 'heap');
        this._heapIntervalBytes = parseEnvInt(EnvOpt.HeapInterval) ?? 512 * 1024;
        this._heapStackDepth = parseEnvInt(EnvOpt.HeapStackDepth) ?? 64;
    }

    protected _start(): void {
        pprof.heap.start(this._heapIntervalBytes, this._heapStackDepth);
    }

    protected _stop(): perftools.profiles.IProfile {
        return pprof.heap.profile();
    }
}

class TimeProfiler extends Profiler {
    private _timeIntervalMicros: number;
    private _stopFn?: () => perftools.profiles.IProfile;

    constructor() {
        super(EnvOpt.TimeOut, 'time');
        this._timeIntervalMicros = parseEnvInt(EnvOpt.TimeInterval) ?? 1000;
    }

    protected _start(): void {
        this._stopFn = pprof.time.start(
            this._timeIntervalMicros,
            /* name */ undefined,
            /* sourceMapper */ undefined,
            lineNumbers
        );
    }

    protected _stop(): perftools.profiles.IProfile {
        assert(this._stopFn);
        return this._stopFn();
    }
}

const profilers: Profiler[] = [];

for (const x of parseEnvSet(EnvOpt.Profilers, 'heap,time')) {
    switch (x) {
        case 'heap':
            profilers.push(new HeapProfiler());
            break;
        case 'time':
            profilers.push(new TimeProfiler());
            break;
        default:
            exitError(`unknown profiler ${x}`);
    }
}

if (profilers.length) {
    for (const p of profilers) {
        p.start();
    }

    signalExit(() => {
        for (const p of profilers) {
            p.stop();
        }

        for (const p of profilers) {
            p.write();
        }
    });
}
