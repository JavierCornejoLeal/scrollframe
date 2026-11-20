#!/usr/bin/env node
import { runCli } from "./run.js";

// exitCode (not process.exit) lets piped stdout/stderr flush before the process ends.
runCli(process.argv.slice(2), process).then((code) => {
  process.exitCode = code;
});
