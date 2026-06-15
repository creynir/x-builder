#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

await import(pathToFileURL(resolve(process.cwd(), "dist/bin/predict.js")).href);
