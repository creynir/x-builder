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

// Keep the process alive until a shutdown signal. In launch mode the launched
// browser process holds the event loop open; in reconnect mode (connectOverCDP)
// nothing does, so without this the process would exit right after start() and
// tear down the CDP transport bindings — taking the injected overlay down with
// it. Block here; SIGINT/SIGTERM run `shutdown` and exit cleanly.
await new Promise(() => {});
