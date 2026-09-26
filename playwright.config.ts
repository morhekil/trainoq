import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./visual",
  testMatch: "*.pw.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5178",
    browserName: "chromium",
    channel: "chrome",
    colorScheme: "light",
    viewport: { width: 390, height: 844 },
  },
  expect: { toHaveScreenshot: { animations: "disabled", caret: "hide", scale: "css" } },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5178 --strictPort",
    url: "http://127.0.0.1:5178",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
