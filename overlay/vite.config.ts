import { defineConfig } from "vite";

export default defineConfig({
  // The overlay ships as a single IIFE injected into a raw page via the runner's
  // `addInitScript` — there is no Node, no bundler-provided `process`, no
  // `import.meta.env`. React (and a few deps) reference `process.env.NODE_ENV`
  // and a `typeof process === "object"` guard for `process.emit`. Left bare,
  // the `process.env.NODE_ENV` reads throw `process is not defined` at eval
  // time, before `window.__xbBootstrap` is ever assigned (XOB-033 defect #1).
  //
  // Statically substitute every bare `process` reference so the IIFE evaluates
  // in a raw page with zero `process` lookups: pin NODE_ENV to "production"
  // (also strips React dev-only code), give `process.env` an empty object for
  // any other `process.env.*` read, and define `process` itself so the
  // `typeof process` guard resolves without touching an undefined global.
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env": "{}",
    process: '{"env":{}}',
  },
  build: {
    lib: {
      entry: "src/index.ts",
      name: "XBuilderOverlay",
      formats: ["iife"],
      fileName: () => "overlay.iife.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: [],
    },
  },
});
