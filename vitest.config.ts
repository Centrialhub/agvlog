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
    testTimeout: 60000,
    hookTimeout: 60000,
    // Ensure we don't accidentally swallow process.env in CI
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
