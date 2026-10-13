import { defineConfig } from "@playwright/test";

// Browser tests (Stage 7): a real browser works through the screens like a person, and each test
// checks the database afterwards. They run against `next dev` in local preview mode on a demo
// database ("mrd_e2e", rebuilt from the migrations + scripts/dev-seed.sql before every run).
// Run: npm run e2e   (needs the local PostgreSQL server, like the other tests)

const SUPER_ADMIN = "6f1c2a3e-0000-4000-8000-000000000d01"; // "Dev Admin" in scripts/dev-seed.sql
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,               // one shared demo database: tests run one after another
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1400, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: { PGDATABASE: "mrd_e2e", MRD_DEV_USER_ID: SUPER_ADMIN, NEXT_TELEMETRY_DISABLED: "1" },
  },
});
