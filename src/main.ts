#!/usr/bin/env node
import path from "node:path";

import foregroundChild from "foreground-child";

const args = [...process.execArgv, `--require=${path.join(__dirname, "index.js")}`, ...process.argv.slice(2)];

foregroundChild(process.execPath, args);
