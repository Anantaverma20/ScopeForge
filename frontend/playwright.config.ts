import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks for the essential ScopeForge workflows.
 *
 * These run against the real backend on port 8787 - start it first:
 *   cd backend && .venv/Scripts/python -m uvicorn app.main:app --port 8787
 *
 * They exercise the real API. They never assert on numbers that would require
 * credentials; where credentials are absent they assert that the UI says so.
 */
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5273",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5273",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
