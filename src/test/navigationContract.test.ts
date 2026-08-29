import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function routePattern(path: string): RegExp {
  const escaped = path
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[^/]+/g, '[^/]+');
  return new RegExp(`^${escaped}$`);
}

describe('internal navigation contract', () => {
  it('keeps literal links and navigation targets backed by an application route', () => {
    const appRoutes = readFileSync(join(root, 'src', 'app', 'AppRoutes.tsx'), 'utf8');
    const rawPaths = [...appRoutes.matchAll(/<Route\b[^>]*\bpath="([^"]+)"/g)]
      .map((match) => match[1]);
    const declaredPaths = rawPaths.flatMap((path) => {
      if (path.startsWith('/')) return [path];
      if (path === '*') return [];
      return [`/portal/${path}`];
    });
    const declaredPatterns = declaredPaths.map(routePattern);

    const source = sourceFiles(join(root, 'src'))
      .filter((path) => !/[\\/](?:test|__tests__)[\\/]/.test(path))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');

    const literalTargets = new Set([
      ...[...source.matchAll(/\bnavigate\(\s*['"](\/[^'"]*)['"]/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bhref:\s*['"](\/[^'"]*)['"]/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bto=\s*['"](\/[^'"]*)['"]/g)].map((match) => match[1]),
    ].map((target) => target.split(/[?#]/, 1)[0]));

    const missing = [...literalTargets]
      .filter((target) => !declaredPatterns.some((pattern) => pattern.test(target)))
      .sort();

    expect(missing).toEqual([]);
  });

  it('keeps every application surface behind its intended route guard', () => {
    const appRoutes = readFileSync(join(root, 'src', 'app', 'AppRoutes.tsx'), 'utf8');
    const absoluteRouteLines = appRoutes
      .split(/\r?\n/)
      .filter((line) => /<Route\b[^>]*\bpath="\//.test(line));
    const guardedPaths = new Set<string>();

    for (const line of absoluteRouteLines) {
      const path = line.match(/\bpath="([^"]+)"/)?.[1];
      expect(path, `route line must declare a path: ${line.trim()}`).toBeTruthy();
      if (!path) continue;

      if (path === '/auth') {
        expect(line).toContain('element={<AuthRoute />}');
      } else if (path === '/set-password') {
        expect(line).toContain('<SetPassword />');
      } else if (path === '/routes') {
        expect(line).toContain('<Navigate to="/corridors" replace />');
      } else if (path === '/portal') {
        expect(appRoutes).toMatch(
          /<Route\s+path="\/portal"[\s\S]*?<ClientRoute>[\s\S]*?<RequireClientPortalAccess>[\s\S]*?<PortalLayout \/>[\s\S]*?<\/RequireClientPortalAccess>[\s\S]*?<\/ClientRoute>/,
        );
        guardedPaths.add(path);
      } else if (path === '/driver' || path.startsWith('/driver/')) {
        expect(line, `${path} must use DriverRoute`).toContain('<DriverRoute>');
        guardedPaths.add(path);
      } else {
        expect(line, `${path} must use ProtectedRoute`).toContain('<ProtectedRoute');
        guardedPaths.add(path);
      }
    }

    expect(appRoutes).toMatch(
      /<Route\s+path="\/portal"[\s\S]*?<ClientRoute>[\s\S]*?<RequireClientPortalAccess>[\s\S]*?<PortalLayout \/>[\s\S]*?<\/RequireClientPortalAccess>[\s\S]*?<\/ClientRoute>/,
    );
    guardedPaths.add('/portal');

    expect(guardedPaths.size).toBeGreaterThan(70);
    expect(guardedPaths).toContain('/');
    expect(guardedPaths).toContain('/portal');
    expect(guardedPaths).toContain('/driver');
  });
});
