import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./e2e',testMatch:'driver-offline-indexeddb.spec.ts',fullyParallel:false,workers:1,timeout:45_000,
  use:{baseURL:'http://127.0.0.1:4187',trace:'retain-on-failure'},
  projects:[{name:'chromium-indexeddb',use:{...devices['Desktop Chrome']}}],
});
