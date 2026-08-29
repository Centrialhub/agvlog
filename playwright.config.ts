import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

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
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
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
