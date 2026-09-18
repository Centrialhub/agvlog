import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { componentTagger } from "lovable-tagger";
import { publicRuntimeConfigIssues } from "./src/config/publicRuntimeConfig";

const normalizedId = (id: string) => id.replace(/\\/g, "/");

const deterministicBuildTime = () => {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (Number.isFinite(epoch) && epoch >= 0) return new Date(epoch * 1000).toISOString();
  try {
    return execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return new Date(0).toISOString();
  }
};

const manualChunks = (id: string) => {
  const moduleId = normalizedId(id);
  if (
    moduleId.endsWith('/src/lib/driver/driverOfflineOutbox.ts') ||
    moduleId.endsWith('/src/lib/driver/driverExpenseOfflineStore.ts')
  ) return 'driver-offline';
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

const pwaDriverAssetManifest = (): Plugin => ({
  name: 'pwa-driver-asset-manifest',
  generateBundle(_options,bundle){
    const chunks=Object.values(bundle).filter((item):item is Extract<typeof item,{type:'chunk'}>=>item.type==='chunk');
    const byFile=new Map(chunks.map(chunk=>[chunk.fileName,chunk]));
    const selected=new Set<string>();
    const include=(fileName:string)=>{
      if(selected.has(fileName))return;selected.add(fileName);
      const chunk=byFile.get(fileName);if(!chunk)return;
      chunk.imports.forEach(include);
    };
    for(const chunk of chunks){
      const isDriver=chunk.moduleIds.some(id=>{
        const moduleId=normalizedId(id);
        return moduleId.includes('/pages/driver/')||moduleId.includes('/components/driver/')||moduleId.endsWith('/components/layout/DriverLayout.tsx');
      });
      const isAuth=chunk.moduleIds.some(id=>normalizedId(id).endsWith('/pages/Auth.tsx'));
      if(chunk.isEntry||isDriver||isAuth)include(chunk.fileName);
    }
    for(const item of Object.values(bundle))if(item.type==='asset'&&item.fileName.endsWith('.css'))selected.add(item.fileName);
    const driverAssets=JSON.stringify([...selected].sort().map(file=>`/${file}`));
    const workerTemplate=readFileSync(path.resolve(__dirname,'public/sw.js'),'utf8');
    if(!workerTemplate.includes('__AGVLOG_BUILD_HASH__'))throw new Error('Service worker build token is missing.');
    const digest=createHash('sha256');
    for(const [fileName,item] of Object.entries(bundle).sort(([first],[second])=>first.localeCompare(second))){
      digest.update(fileName);digest.update(item.type==='chunk'?item.code:typeof item.source==='string'?item.source:item.source);
    }
    for(const publicFile of ['manifest.webmanifest','icons/agvlog-192.png','icons/agvlog-512.png']){
      digest.update(publicFile);digest.update(readFileSync(path.resolve(__dirname,'public',publicFile)));
    }
    const release=process.env.VITE_APP_RELEASE??process.env.VERCEL_GIT_COMMIT_SHA??process.env.GITHUB_SHA??'development';
    digest.update(driverAssets);digest.update(workerTemplate);digest.update(release);
    const buildHash=digest.digest('hex').slice(0,16);
    const builtAt=deterministicBuildTime();
    this.emitFile({type:'asset',fileName:'driver-shell-assets.json',source:driverAssets});
    this.emitFile({type:'asset',fileName:'driver-build.json',source:JSON.stringify({
      version:process.env.npm_package_version??'development',release,buildHash,builtAt,
    })});
    this.emitFile({type:'asset',fileName:'release.json',source:JSON.stringify({release,buildHash,builtAt})});
    this.emitFile({type:'asset',fileName:'sw.js',source:workerTemplate.replace(/__AGVLOG_BUILD_HASH__/g,buildHash)});
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const buildEnvironment = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const configurationIssues = publicRuntimeConfigIssues(buildEnvironment);
  if (process.env.VERCEL === "1" && configurationIssues.length > 0) {
    throw new Error(`Invalid Vercel public build configuration: ${configurationIssues.join(", ")}`);
  }

  return ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), pwaDriverAssetManifest(), mode === "development" && componentTagger()].filter(Boolean),
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
  });
});
