import { defineConfig, devices } from "@playwright/test";
import { PORT, BASE_URL, E2E_DATABASE_URL } from "./e2e/config";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: [["list"]],
  // DB setup runs as a pre-step in the `e2e` npm script (before the web server
  // starts), so /api/health is green by the time Playwright probes it.
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // These override any .env values (Next does not override an already-set env var).
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      JWT_SECRET: "e2e-test-secret-0123456789abcdef0123456789abcdef",
      BOT_TOKEN: "0:dummy-e2e-token",
      BOT_USERNAME: "toto_wc2026_bot",
      ADMIN_TELEGRAM_ID: "100001",
      ALLOW_DEV_LOGIN: "true",
      NEXT_PUBLIC_ALLOW_DEV_LOGIN: "true",
    },
  },
});
