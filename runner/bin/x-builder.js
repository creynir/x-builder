#!/usr/bin/env node
// x-builder runner entry point. Thin shim over the built RunnerApp so the bin
// stays at bin/x-builder.js (where package.json `bin` points) without forcing
// the bin file under the src rootDir. SIGINT/SIGTERM close the browser context
// cleanly before exit.
import { RunnerApp } from "../dist/runner-app.js";

const app = new RunnerApp();

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.start();
