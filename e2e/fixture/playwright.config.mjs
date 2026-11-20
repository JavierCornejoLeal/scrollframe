import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /demo\.spec/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testIgnore: /demo\.spec/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: /demo\.spec/ },
    // Records the scroll on every run: download it from the CI artifacts to watch it.
    {
      name: "demo",
      testMatch: /demo\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        video: { mode: "on", size: { width: 1280, height: 720 } },
      },
    },
  ],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
