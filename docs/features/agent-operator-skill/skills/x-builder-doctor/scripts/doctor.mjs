#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import http from "node:http";

const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const requireBuild = args.has("--require-build");
const requireCdp = args.has("--require-cdp");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../../../../..");
const settingsRoot = join(homedir(), ".x-builder", "engine-settings");
const storageDir = join(settingsRoot, "storage");
const dbPath = join(storageDir, "x-builder.db");
const cdpEndpoint = process.env.XB_CDP_ENDPOINT || "http://127.0.0.1:9222";

const checks = [];

const add = (status, name, detail, remediation) => {
  checks.push({ status, name, detail, ...(remediation ? { remediation } : {}) });
};

const commandExists = (command) => {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout || result.stderr}`.trim(),
  };
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const checkRepo = () => {
  const packagePath = join(repoRoot, "package.json");
  if (!existsSync(packagePath)) {
    add("fail", "repo package.json", `Missing ${packagePath}.`, "Run the doctor from the checked-in skill path inside x-builder.");
    return;
  }

  const pkg = readJson(packagePath);
  add("pass", "repo package.json", `Found ${pkg.name || "unnamed package"} at ${repoRoot}.`);

  if (pkg.packageManager === "pnpm@9.15.0") {
    add("pass", "package manager", "package.json pins pnpm@9.15.0.");
  } else {
    add("warn", "package manager", `Expected pnpm@9.15.0, found ${pkg.packageManager || "none"}.`);
  }
};

const checkNodeAndPnpm = () => {
  const major = Number.parseInt(process.versions.node.split(".")[0] || "0", 10);
  if (major >= 20) {
    add("pass", "node version", `Node ${process.version}.`);
  } else {
    add("fail", "node version", `Node ${process.version}; x-builder expects Node 20+.`, "Install/use Node 20+.");
  }

  const pnpm = commandExists("pnpm");
  if (pnpm.ok) {
    add("pass", "pnpm available", pnpm.output || "pnpm is available.");
  } else {
    add("fail", "pnpm available", "pnpm is not available on PATH.", "Enable Corepack or install pnpm 9.15.0.");
  }
};

const checkBuildArtifacts = () => {
  const artifacts = [
    {
      name: "overlay bundle",
      path: join(repoRoot, "overlay", "dist", "overlay.iife.js"),
      remediation: "Run: pnpm --filter @x-builder/overlay build",
    },
    {
      name: "runner dist",
      path: join(repoRoot, "runner", "dist", "runner-app.js"),
      remediation: "Run: pnpm --filter @x-builder/runner build",
    },
  ];

  for (const artifact of artifacts) {
    if (existsSync(artifact.path)) {
      add("pass", artifact.name, `Found ${artifact.path}.`);
      continue;
    }

    add(
      requireBuild ? "fail" : "warn",
      artifact.name,
      `Missing ${artifact.path}.`,
      artifact.remediation,
    );
  }
};

const sqliteUserVersion = () => {
  const sqlite = spawnSync("sqlite3", [dbPath, "PRAGMA user_version;"], { encoding: "utf8" });
  if (sqlite.status !== 0) {
    return undefined;
  }

  const version = Number.parseInt(sqlite.stdout.trim(), 10);
  return Number.isFinite(version) ? version : undefined;
};

const checkStorage = () => {
  if (!existsSync(settingsRoot)) {
    add("warn", "settings root", `Missing ${settingsRoot}. This is normal before first run.`);
  } else {
    add("pass", "settings root", `Found ${settingsRoot}.`);
  }

  if (!existsSync(dbPath)) {
    add("warn", "local sqlite database", `Missing ${dbPath}. This is normal before first runner/engine startup.`);
    return;
  }

  const stat = statSync(dbPath);
  const mode = (stat.mode & 0o777).toString(8).padStart(3, "0");
  add("pass", "local sqlite database", `Found ${dbPath} (${stat.size} bytes, mode ${mode}).`);

  if (mode !== "600") {
    add("warn", "database permissions", `Expected mode 600, found ${mode}.`, "Run x-builder normally so openEngineDatabase can chmod the file.");
  } else {
    add("pass", "database permissions", "Database mode is 600.");
  }

  const version = sqliteUserVersion();
  if (version === undefined) {
    add("warn", "sqlite user_version", "sqlite3 CLI unavailable or could not read PRAGMA user_version.");
  } else if (version >= 4) {
    add("pass", "sqlite user_version", `PRAGMA user_version=${version}.`);
  } else {
    add("warn", "sqlite user_version", `PRAGMA user_version=${version}; current migrations reach 4.`, "Run the app normally so supported migrations apply.");
  }
};

const fetchJson = (url) =>
  new Promise((resolveFetch) => {
    const request = http.get(url, { timeout: 1500 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        resolveFetch({ ok: response.statusCode && response.statusCode < 400, statusCode: response.statusCode, body });
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("timeout"));
    });
    request.on("error", (error) => {
      resolveFetch({ ok: false, error: error.message });
    });
  });

const checkCdp = async () => {
  const url = new URL("/json/version", cdpEndpoint).toString();
  const result = await fetchJson(url);
  if (!result.ok) {
    add(
      requireCdp ? "fail" : "warn",
      "chrome cdp endpoint",
      `Could not read ${url}${result.error ? ` (${result.error})` : ""}.`,
      "Start/reuse Chrome with --remote-debugging-port=9222 and set XB_CDP_ENDPOINT if using a different port.",
    );
    return;
  }

  let product = "unknown Chrome product";
  try {
    product = JSON.parse(result.body).Browser || product;
  } catch {
    // Keep the HTTP success; malformed JSON is still useful diagnostic detail.
  }
  add("pass", "chrome cdp endpoint", `Reachable at ${cdpEndpoint} (${product}).`);
};

const printText = () => {
  for (const check of checks) {
    const label = check.status.toUpperCase().padEnd(4);
    console.log(`[${label}] ${check.name}: ${check.detail}`);
    if (check.remediation) {
      console.log(`       fix: ${check.remediation}`);
    }
  }
};

checkRepo();
checkNodeAndPnpm();
checkBuildArtifacts();
checkStorage();
await checkCdp();

if (json) {
  console.log(JSON.stringify({ repoRoot, settingsRoot, cdpEndpoint, checks }, null, 2));
} else {
  printText();
}

process.exitCode = checks.some((check) => check.status === "fail") ? 1 : 0;
