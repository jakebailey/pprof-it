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
import * as unload from 'unload';

function tryStat(p: string) {
    try {
        return fs.statSync(p);
    } catch {
        return undefined;
    }
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

function assertExistsAndDir(p: string) {
    if (!tryStat(p)?.isDirectory()) {
        throw new Error(`${p} does not exist, or is not a directory`);
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

const quiet = parseEnvBoolean('PPROF_QUIET') ?? false;

function log(message: string): void {
    if (!quiet) {
        console.error(message);
    }
}

const outDir = parseEnvDir('PPROF_OUT') ?? process.cwd();

function getOutputPath(envName: string, defaultFilename: string): string {
    const p = path.resolve(outDir, process.env[envName] || '');

    if (tryStat(p)?.isDirectory()) {
        return path.join(p, defaultFilename);
    }

    assertExistsAndDir(path.dirname(p));
    return p;
}

function heapProfile() {
    const profilePath = getOutputPath('PPROF_HEAP', `pprof-heap-profile-${process.pid}.pb.gz`);

    // The average number of bytes between samples.
    const heapIntervalBytes = parseEnvInt('PPROF_HEAP_INTERVAL') ?? 512 * 1024;

    // The maximum stack depth for samples collected.
    const heapStackDepth = parseEnvInt('PPROF_HEAP_STACK_DEPTH') ?? 64;

    log('Starting heap profile');
    pprof.heap.start(heapIntervalBytes, heapStackDepth);

    unload.add(() => {
        log('Ending heap profile');
        const profile = pprof.heap.profile();
        const buffer = pprof.encodeSync(profile);
        fs.writeFileSync(profilePath, buffer);
        log(`Wrote heap profile to ${profilePath}`);
    });
}

function timeProfile() {
    const profilePath = getOutputPath('PPROF_TIME', `pprof-time-profile-${process.pid}.pb.gz`);

    log('Starting time profile');
    const stop = pprof.time.start();

    unload.add(() => {
        log('Ending time profile');
        const profile = stop();
        const buffer = pprof.encodeSync(profile);
        fs.writeFileSync(profilePath, buffer);
        log(`Wrote time profile to ${profilePath}`);
    });
}

const toRun = (process.env['PPROF'] || 'time,heap').split(',');
for (const x of toRun) {
    switch (x) {
        case 'heap':
            heapProfile();
            break;
        case 'time':
            timeProfile();
            break;
    }
}
