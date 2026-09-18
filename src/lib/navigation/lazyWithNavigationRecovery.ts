import {
  lazy as reactLazy,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

const RECOVERY_MARKER_KEY = "agvlog:navigation-chunk-recovery";
const MODULE_LOAD_TIMEOUT_MS = 20_000;

interface RecoveryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface NavigationRecoveryContext {
  release: string;
  href: string;
  storage: RecoveryStorage;
  reload: () => void;
}

function errorDescription(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function isNavigationChunkLoadError(error: unknown): boolean {
  const description = errorDescription(error).toLowerCase();
  return [
    "failed to fetch dynamically imported module",
    "error loading dynamically imported module",
    "importing a module script failed",
    "chunkloaderror",
    "loading chunk",
    "navigation module load timed out",
  ].some((fragment) => description.includes(fragment));
}

function browserRecoveryContext(): NavigationRecoveryContext | null {
  if (typeof window === "undefined") return null;
  return {
    release: import.meta.env.VITE_APP_RELEASE || "unknown",
    href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    storage: window.sessionStorage,
    reload: () => window.location.reload(),
  };
}

export function recoverNavigationFromChunkLoad(
  error: unknown,
  context: NavigationRecoveryContext | null = browserRecoveryContext(),
): boolean {
  if (!context || !isNavigationChunkLoadError(error)) return false;

  const marker = `${context.release}:${context.href}`;
  try {
    if (context.storage.getItem(RECOVERY_MARKER_KEY) === marker) return false;
    context.storage.setItem(RECOVERY_MARKER_KEY, marker);
  } catch {
    // Session storage is optional; a reload is still the safest recovery.
  }
  context.reload();
  return true;
}

function clearNavigationRecoveryMarker() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(RECOVERY_MARKER_KEY);
  } catch {
    // Storage may be unavailable in hardened browser contexts.
  }
}

async function loadNavigationModule<T extends ComponentType>(
  importer: () => Promise<{ default: T }>,
): Promise<{ default: T }> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      importer(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Navigation module load timed out")),
          MODULE_LOAD_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function lazyWithNavigationRecovery<T extends ComponentType>(
  importer: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return reactLazy(async () => {
    try {
      const module = await loadNavigationModule(importer);
      clearNavigationRecoveryMarker();
      return module;
    } catch (error) {
      if (recoverNavigationFromChunkLoad(error)) {
        return new Promise<{ default: T }>(() => {
          // Keep Suspense mounted while the browser replaces the stale shell.
        });
      }
      throw error;
    }
  });
}
