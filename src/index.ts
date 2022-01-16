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
import * as fs from 'fs';
import * as path from 'path';
import signalExit from 'signal-exit';

const enum EnvOpt {
    Profiles = 'PPROF_PROFILES',
    Out = 'PPROF_OUT',
    logging = 'PPROF_LOGGING',
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
    if (!tryStat(p)?.isDirectory()) {
        throw new Error(`${p} does not exist, or is not a directory`);
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

const logging = parseEnvBoolean(EnvOpt.logging) ?? true;

function log(message: string): void {
    if (logging) {
        console.error(message);
    }
}

const outDir = parseEnvDir(EnvOpt.Out) ?? process.cwd();

function getOutputPath(envName: EnvOpt, defaultFilename: string): string {
    const p = path.resolve(outDir, process.env[envName] || '');

    if (tryStat(p)?.isDirectory()) {
        return path.join(p, defaultFilename);
    }

    assertExistsAndDir(path.dirname(p));
    return p;
}

function heapProfile() {
    const profilePath = getOutputPath(EnvOpt.HeapOut, `pprof-heap-profile-${process.pid}.pb.gz`);

    // The average number of bytes between samples.
    const heapIntervalBytes = parseEnvInt(EnvOpt.HeapInterval) ?? 512 * 1024;

    // The maximum stack depth for samples collected.
    const heapStackDepth = parseEnvInt(EnvOpt.HeapStackDepth) ?? 64;

    log('Starting heap profile');
    pprof.heap.start(heapIntervalBytes, heapStackDepth);

    signalExit(() => {
        log('Ending heap profile');
        const profile = pprof.heap.profile();
        const buffer = pprof.encodeSync(profile);
        fs.writeFileSync(profilePath, buffer);
        log(`Wrote heap profile to ${profilePath}`);
    });
}

function timeProfile() {
    const profilePath = getOutputPath(EnvOpt.TimeOut, `pprof-time-profile-${process.pid}.pb.gz`);

    log('Starting time profile');
    const stop = pprof.time.start();

    signalExit(() => {
        log('Ending time profile');
        const profile = stop();
        const buffer = pprof.encodeSync(profile);
        fs.writeFileSync(profilePath, buffer);
        log(`Wrote time profile to ${profilePath}`);
    });
}

// TODO: instead of an onExit for each profile, just make note of which are in progress,
// stop all, then encode/write all.

// TODO: dedupe this
const profiles = (process.env[EnvOpt.Profiles] || 'time,heap').split(',');
for (const x of profiles) {
    switch (x) {
        case 'heap':
            heapProfile();
            break;
        case 'time':
            timeProfile();
            break;
    }
}
