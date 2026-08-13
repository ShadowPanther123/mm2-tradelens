import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests drive the desktop UI in browser mode (the same build the
 * Tauri shell hosts), against the Vite dev server on its fixed port. Data lives
 * in a fresh localStorage per test, so runs are isolated and repeatable.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Consistent viewport keeps screenshot-regression baselines stable.
  snapshotDir: "./e2e/__screenshots__",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1100, height: 760 },
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
