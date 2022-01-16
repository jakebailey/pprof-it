function isPreloading(): boolean {
    if ((module as any).isPreloading !== undefined) {
        // >=v14.17.0
        return (module as any).isPreloading;
    }

    return module.parent?.id === 'internal/preload';
}

if (!isPreloading()) {
    throw new Error('PPROF must be required using the --require flag');
}

import * as pprof from '@datadog/pprof';
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import signalExit from 'signal-exit';

const enum EnvOpt {
    Profiles = 'PPROF_PROFILES',
    Out = 'PPROF_OUT',
    Logging = 'PPROF_LOGGING',
    HeapOut = 'PPROF_HEAP_OUT',
    HeapInterval = 'PPROF_HEAP_INTERVAL',
    HeapStackDepth = 'PPROF_HEAP_STACK_DEPTH',
    TimeOut = 'PPROF_TIME_OUT',
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
    return v ? parseInt(v) : undefined;
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
            throw new Error(`invalid value ${envName}=${v}`);
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

type Profile = ReturnType<typeof pprof.heap.profile>;

abstract class Profiler {
    private _profilePath: string;
    private _profile?: Profile;

    constructor(pathEnvName: EnvOpt, private _name: string) {
        this._profilePath = parseOutputPath(pathEnvName, `pprof-${_name}-profile-${process.pid}.pb.gz`);
    }

    protected abstract _start(): void;

    start(): void {
        log(`Starting ${this._name} profile`);
        this._start();
    }

    protected abstract _stop(): Profile;

    stop(): void {
        log(`Stopping ${this._name} profile`);
        this._profile = this._stop();
    }

    write(): void {
        assert(this._profile);
        log(`Writing ${this._name} profile to ${this._profilePath}`);
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

    protected _stop(): Profile {
        return pprof.heap.profile();
    }
}

class TimeProfiler extends Profiler {
    private _stopFn?: () => Profile;

    constructor() {
        super(EnvOpt.TimeOut, 'time');
    }

    protected _start(): void {
        this._stopFn = pprof.time.start();
    }

    protected _stop(): Profile {
        assert(this._stopFn);
        return this._stopFn();
    }
}

const profilers: Profiler[] = [];

for (const x of parseEnvSet(EnvOpt.Profiles, 'heap,time')) {
    switch (x) {
        case 'heap':
            profilers.push(new HeapProfiler());
            break;
        case 'time':
            profilers.push(new TimeProfiler());
            break;
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
