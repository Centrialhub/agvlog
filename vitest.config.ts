import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // PGlite/WASM suites are CPU-heavy; keeping worker fan-out bounded prevents
    // Vitest's coordinator RPC from starving while preserving file isolation.
    maxWorkers: 4,
    setupFiles: [path.resolve(projectRoot, "src/test/setup.ts")],
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
    alias: { "@": path.resolve(projectRoot, "src") },
  },
});
