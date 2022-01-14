function isPreloading(): boolean {
    if ((module as any).isPreloading !== undefined) {
        // >=v14.17.0
        return (module as any).isPreloading;
    }

    return module.parent?.id === 'internal/preload';
}

if (!isPreloading()) {
    throw new Error('pprofer must be required using the --require flag');
}

import * as pprof from '@datadog/pprof';
import * as catchExit from 'catch-exit';
import * as fs from 'fs';
import * as path from 'path';

function tryStat(p: string) {
    try {
        return fs.statSync(p);
    } catch {
        return undefined;
    }
}

function getOutputPath(envName: string, defaultFilename: string): string {
    const p = process.env[envName] || process.cwd();

    if (tryStat(p)?.isDirectory()) {
        return path.join(p, defaultFilename);
    }

    return p;
}

function parseEnvInt(envName: string): number | undefined {
    const v = process.env[envName];
    return v ? parseInt(v) : undefined;
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
            return true;
        case '0':
        case 'false':
        case 'no':
            return false;
        default:
            throw new Error(`invalid value ${envName}=${v}`);
    }
}

function parseDir(envName: string): string | undefined {
    const v = process.env[envName];
    if (!v) {
        return undefined;
    }

    if (!tryStat(v)?.isDirectory()) {
        throw new Error(`${envName} does not exist, or is not a directory`);
    }

    return v;
}

const quiet = parseEnvBoolean('PPROFER_QUIET') ?? false;

function log(message: string): void {
    if (!quiet) {
        console.error(message);
    }
}

const outDir = parseDir('PPROFER_OUT') ?? process.cwd();
const heapProfilePath = getOutputPath('PPROFER_HEAP', `pprof-heap-profile-${process.pid}.pb.gz`);
const timeProfilePath = getOutputPath('PPROFER_TIME', `pprof-time-profile-${process.pid}.pb.gz`);

function heapProfile() {
    // The average number of bytes between samples.
    const heapIntervalBytes = parseEnvInt('PPROFER_HEAP_INTERVAL') ?? 512 * 1024;

    // The maximum stack depth for samples collected.
    const heapStackDepth = parseEnvInt('PPROFER_HEAP_STACK_DEPTH') ?? 64;

    log('Starting heap profile');
    pprof.heap.start(heapIntervalBytes, heapStackDepth);

    catchExit.addExitCallback(() => {
        const profile = pprof.heap.profile();
        const buffer = pprof.encodeSync(profile);
        fs.writeFileSync(heapProfilePath, buffer);
        log(`Wrote profile to ${heapProfilePath}`);
    });
}

function timeProfile() {
    const stop = pprof.time.start();

    catchExit.addExitCallback(() => {
        log('Ending time profile');
        const profile = stop();
        const buffer = pprof.encodeSync(profile);
        fs.writeFileSync(timeProfilePath, buffer);
        log(`Wrote profile to ${timeProfilePath}`);
    });
}
