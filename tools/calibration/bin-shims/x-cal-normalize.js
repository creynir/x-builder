#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

await import(pathToFileURL(resolve(process.cwd(), "dist/bin/normalize.js")).href);
