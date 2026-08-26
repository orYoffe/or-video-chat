import { defineConfig, devices } from "playwright/test";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  expect: {
    timeout: 5_000,
  },
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
    {
      name: "android-chromium",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
    },
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "node scripts/serve-public.mjs",
        url: baseURL,
        reuseExistingServer: true,
      },
});
