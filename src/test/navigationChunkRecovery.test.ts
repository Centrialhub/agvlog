import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  isNavigationChunkLoadError,
  recoverNavigationFromChunkLoad,
  type NavigationRecoveryContext,
} from "@/lib/navigation/lazyWithNavigationRecovery";

function recoveryContext() {
  const values = new Map<string, string>();
  const reload = vi.fn();
  const context: NavigationRecoveryContext = {
    release: "release-one",
    href: "/reports?period=current",
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => { values.delete(key); },
    },
    reload,
  };
  return { context, reload };
}

describe("navigation chunk recovery", () => {
  it("recognizes browser and timeout failures from lazy route modules", () => {
    expect(isNavigationChunkLoadError(new TypeError("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isNavigationChunkLoadError(new Error("ChunkLoadError: Loading chunk 42 failed"))).toBe(true);
    expect(isNavigationChunkLoadError(new Error("Navigation module load timed out"))).toBe(true);
    expect(isNavigationChunkLoadError(new Error("permission denied"))).toBe(false);
  });

  it("reloads a stale route once and prevents a reload loop for the same release and URL", () => {
    const { context, reload } = recoveryContext();
    const failure = new TypeError("Failed to fetch dynamically imported module");

    expect(recoverNavigationFromChunkLoad(failure, context)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(recoverNavigationFromChunkLoad(failure, context)).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("applies recovery to every lazy route and reloads every app role on worker takeover", () => {
    const root = process.cwd();
    const routes = readFileSync(join(root, "src", "app", "AppRoutes.tsx"), "utf8");
    const guards = readFileSync(join(root, "src", "app", "routeGuards.tsx"), "utf8");
    const main = readFileSync(join(root, "src", "main.tsx"), "utf8");
    const driverInstall = readFileSync(join(root, "src", "components", "driver", "DriverPwaInstall.tsx"), "utf8");

    expect(routes).toContain("lazyWithNavigationRecovery as lazy");
    expect(guards).toContain("lazyWithNavigationRecovery as lazy");
    expect(main).toContain("navigator.serviceWorker.addEventListener('controllerchange', reloadForControllerChange)");
    expect(driverInstall).not.toContain("addEventListener('controllerchange'");
  });
});
