import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  use: {
    baseURL: "http://127.0.0.1:5173"
  },
  webServer: {
    command: "pnpm --filter @x-builder/client dev -- --port 5173",
    reuseExistingServer: true,
    url: "http://127.0.0.1:5173"
  }
});
