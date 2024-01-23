#!/usr/bin/env node
import foregroundChild from "foreground-child";
import path from "path";

const args = [...process.execArgv, `--require=${path.join(__dirname, "index.js")}`, ...process.argv.slice(2)];

foregroundChild(process.execPath, args);
