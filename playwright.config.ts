import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isImmutableCandidateOrigin } from "./scripts/release-candidate-origin.mjs";
import { assertHostedStagingSupabaseUrl } from "./scripts/release-backend-identity.mjs";

const fileEnv = loadEnv("test", process.cwd(), "");
for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PROJECT_ID"]) {
  if (!process.env[key] && fileEnv[key]) process.env[key] = fileEnv[key];
}

const backendUrl = process.env.VITE_SUPABASE_URL;
if (!backendUrl) {
  throw new Error("E2E requires VITE_SUPABASE_URL from a local Supabase status export.");
}

const backendHost = new URL(backendUrl).hostname;
const localBackend = ["127.0.0.1", "localhost", "::1"].includes(backendHost);
if (!localBackend && process.env.E2E_ALLOW_REMOTE !== "true") {
  throw new Error(
    `Refusing to run destructive E2E against non-local Supabase host ${backendHost}. ` +
    "Use an isolated staging project and set E2E_ALLOW_REMOTE=true explicitly.",
  );
}
const useExternalApp = process.env.E2E_SKIP_WEBSERVER === "true";
const appBaseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const protectedCandidate = isImmutableCandidateOrigin(appBaseUrl);
if (useExternalApp && protectedCandidate) {
  assertHostedStagingSupabaseUrl(backendUrl);
}
if (useExternalApp && protectedCandidate && !bypassSecret) {
  throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required for hosted Preview E2E.");
}
if (bypassSecret && (!useExternalApp || !protectedCandidate)) {
  throw new Error("Vercel automation bypass may only target this project's immutable hosted Preview URL.");
}
const bypassStateFile = bypassSecret
  ? process.env.AGVLOG_VERCEL_BYPASS_STATE_FILE ?? join(tmpdir(), `agvlog-preview-${randomUUID()}.json`)
  : undefined;
if (bypassStateFile) process.env.AGVLOG_VERCEL_BYPASS_STATE_FILE = bypassStateFile;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalSetup: bypassSecret ? "./e2e/fixtures/vercelProtectionSetup.ts" : undefined,
  use: {
    baseURL: appBaseUrl,
    storageState: bypassStateFile,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    // Hosted traces can contain the bypass cookie in network metadata and are
    // uploaded as CI artifacts. Keep screenshots/video without that secret.
    trace: bypassSecret ? "off" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: useExternalApp ? undefined : {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/auth",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "tablet-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
