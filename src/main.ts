#!/usr/bin/env node
import path = require("node:path");

import foregroundChild = require("foreground-child");

const args = [...process.execArgv, `--require=${path.join(__dirname, "index.js")}`, ...process.argv.slice(2)];

foregroundChild.foregroundChild(process.execPath, args);
