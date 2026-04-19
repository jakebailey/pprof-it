const child_process = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const heapOut = path.resolve("pprof-heap-test.pb.gz");
const timeOut = path.resolve("pprof-time-test.pb.gz");

for (const f of [heapOut, timeOut]) {
    try {
        fs.unlinkSync(f);
    } catch {}
}

try {
    child_process.execFileSync(process.execPath, [
        path.join(__dirname, "dist", "main.js"),
        path.join(__dirname, "node_modules", "typescript", "lib", "tsc.js"),
    ], {
        env: { ...process.env, PPROF_HEAP_OUT: heapOut, PPROF_TIME_OUT: timeOut },
        stdio: "inherit",
    });
} catch {
    // The profiler crash may or may not affect the exit code;
    // we verify by checking output files below.
}

let failed = false;

for (const f of [heapOut, timeOut]) {
    try {
        const stat = fs.statSync(f);
        if (stat.size === 0) {
            console.error(`FAIL: ${path.basename(f)} is empty`);
            failed = true;
        } else {
            console.error(`OK: ${path.basename(f)} (${stat.size} bytes)`);
        }
    } catch {
        console.error(`FAIL: ${path.basename(f)} is missing`);
        failed = true;
    } finally {
        try {
            fs.unlinkSync(f);
        } catch {}
    }
}

if (failed) {
    console.error("FAILED");
    process.exit(1);
} else {
    console.error("PASSED");
}
