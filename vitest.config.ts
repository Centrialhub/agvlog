import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: [
        "src/lib/status/loadStatus.ts",
        "src/lib/route-planning/routeConsistency.ts",
        "src/lib/route-planning/stopConsolidation.ts",
        "src/lib/fiscalDocuments/nfeAccessKey.ts",
        "src/lib/portalCsv.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 50,
        functions: 75,
        lines: 85,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
