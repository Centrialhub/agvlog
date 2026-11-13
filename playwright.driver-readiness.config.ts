import {defineConfig,devices} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'driver-operational-offline-mutation.spec.ts',workers:1,timeout:45000,
 outputDir:'test-results/driver-readiness',use:{trace:'retain-on-failure'},
 projects:[{name:'readiness-mobile',use:{...devices['Pixel 7']}}]});
