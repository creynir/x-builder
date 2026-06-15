import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
) as {
  bin: Record<string, string>;
  devDependencies: Record<string, string>;
};

const shimPackageJson = JSON.parse(
  readFileSync(join(packageRoot, "bin-shims", "package.json"), "utf8"),
) as {
  bin: Record<string, string>;
};

describe("calibration CLI package metadata", () => {
  it("points bin commands at built JavaScript entrypoints", () => {
    expect(packageJson.bin).toEqual({
      "x-cal-normalize": "./dist/bin/normalize.js",
      "x-cal-predict": "./dist/bin/predict.js",
      "x-cal-fit": "./dist/bin/fit.js",
      "x-cal-validate": "./dist/bin/validate.js",
    });
  });

  it("keeps TypeScript bin sources executable after tsc preserves shebangs", () => {
    for (const target of Object.values(packageJson.bin)) {
      const source = target.replace("./dist/", "./src/").replace(/\.js$/, ".ts");
      const contents = readFileSync(join(packageRoot, source), "utf8");

      expect(contents.startsWith("#!/usr/bin/env node\n")).toBe(true);
    }
  });

  it("exposes the same commands to pnpm exec through a local bin-shim dependency", () => {
    expect(packageJson.devDependencies["@x-builder/calibration-bin-shims"]).toBe(
      "file:./bin-shims",
    );
    expect(shimPackageJson.bin).toEqual({
      "x-cal-normalize": "./x-cal-normalize.js",
      "x-cal-predict": "./x-cal-predict.js",
      "x-cal-fit": "./x-cal-fit.js",
      "x-cal-validate": "./x-cal-validate.js",
    });

    for (const shimPath of Object.values(shimPackageJson.bin)) {
      const contents = readFileSync(join(packageRoot, "bin-shims", shimPath), "utf8");

      expect(contents.startsWith("#!/usr/bin/env node\n")).toBe(true);
      expect(contents).toContain('resolve(process.cwd(), "dist/bin/');
    }
  });
});
