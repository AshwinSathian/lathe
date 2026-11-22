import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests", timeout: 180_000, expect: { timeout: process.env.LATHE_URL ? 15_000 : 5_000 }, // Engines load over a real network in production runs.
  workers: process.env.CI ? 2 : 3, fullyParallel: true, forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["line"]],
  // Model tests download hundreds of megabytes, so CI runs them on a weekly schedule instead.
  testIgnore: process.env.CI && !process.env.LATHE_MODELS ? ["**/ai.spec.ts", "**/webgpu.spec.ts"] : [], globalSetup: "./tests/setup.ts",
  use: { baseURL: process.env.LATHE_URL ?? "http://localhost:8797" },
  // Set LATHE_URL to run the same suite against production.
  webServer: process.env.LATHE_URL ? undefined : { command: "npx wrangler dev --port 8797 --local", url: "http://localhost:8797", reuseExistingServer: true, timeout: 60_000 },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }, { name: "webkit", use: devices["Desktop Safari"] }, { name: "firefox", use: devices["Desktop Firefox"] }],
});
