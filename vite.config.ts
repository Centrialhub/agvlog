import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

const normalizedId = (id: string) => id.replace(/\\/g, "/");

const manualChunks = (id: string) => {
  const moduleId = normalizedId(id);
  if (!moduleId.includes("/node_modules/")) return undefined;

  if (
    moduleId.includes("/node_modules/react/") ||
    moduleId.includes("/node_modules/react-dom/") ||
    moduleId.includes("/node_modules/react-router/") ||
    moduleId.includes("/node_modules/react-router-dom/") ||
    moduleId.includes("/node_modules/scheduler/")
  ) return "react-core";
  if (moduleId.includes("/node_modules/@supabase/")) return "supabase";
  if (moduleId.includes("/node_modules/@tanstack/")) return "query";
  if (moduleId.includes("/node_modules/@radix-ui/")) return "radix-ui";
  if (moduleId.includes("/node_modules/recharts/") || moduleId.includes("/node_modules/d3-")) return "charts";
  if (moduleId.includes("/node_modules/leaflet/") || moduleId.includes("/node_modules/react-leaflet/")) return "maps";
  if (moduleId.includes("/node_modules/xlsx/")) return "spreadsheets";
  if (moduleId.includes("/node_modules/jspdf/") || moduleId.includes("/node_modules/jspdf-autotable/")) return "pdf-jspdf";
  if (moduleId.includes("/node_modules/pdf-lib/") || moduleId.includes("/node_modules/@pdf-lib/")) return "pdf-lib";
  if (moduleId.includes("/node_modules/jszip/")) return "archive";
  if (moduleId.includes("/node_modules/framer-motion/")) return "motion";
  if (moduleId.includes("/node_modules/date-fns/")) return "date";

  return undefined;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  worker: {
    format: "es",
  },
  build: {
    // Keep Vite's decimal-kB warning aligned with the authoritative 500 KiB
    // budget enforced by scripts/check-bundle.mjs.
    chunkSizeWarningLimit: 512,
    rollupOptions: {
      output: { manualChunks },
    },
  },
}));
