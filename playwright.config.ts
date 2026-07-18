import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/test-results",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:1420",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:1420",
    reuseExistingServer: true,
    env: { VITE_MOCK_TAURI: "1" },
  },
});
