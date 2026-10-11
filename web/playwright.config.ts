import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;
const withServer = !!process.env.VITE_SUPABASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    locale: "ru-RU",
    timezoneId: "Asia/Krasnoyarsk",
    // Locally the installed Microsoft Edge is used; CI installs Playwright's Chromium.
    channel: CI ? undefined : "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    { command: "node scripts/e2e-server.mjs local 4173", url: "http://127.0.0.1:4173/", reuseExistingServer: !CI, timeout: 180_000 },
    ...(withServer
      ? [{ command: "node scripts/e2e-server.mjs server 4174", url: "http://127.0.0.1:4174/", reuseExistingServer: !CI, timeout: 180_000 }]
      : []),
  ],
  projects: [
    { name: "local-mobile", testMatch: /local\.spec\.ts/, use: { ...devices["Pixel 7"], channel: CI ? undefined : "msedge", baseURL: "http://127.0.0.1:4173/" } },
    { name: "tiles", testMatch: /tiles\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, baseURL: "http://127.0.0.1:4173/" } },
    { name: "desktop", testMatch: /desktop\.spec\.ts/, use: { viewport: { width: 1440, height: 900 }, baseURL: "http://127.0.0.1:4173/" } },
    ...(withServer ? [{ name: "server", testMatch: /server\.spec\.ts/, use: { viewport: { width: 390, height: 844 }, baseURL: "http://127.0.0.1:4174/" } }] : []),
  ],
});
