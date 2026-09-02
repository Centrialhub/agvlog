// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, 'src');

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'test' ? [] : productionSources(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const directRpcCallers = productionSources(sourceRoot)
  .filter((path) => path !== join(sourceRoot, 'integrations', 'supabase', 'types.ts'))
  .filter((path) => /\.rpc\(\s*['"]driver_mark_arrival['"]/.test(readFileSync(path, 'utf8')))
  .map((path) => relative(projectRoot, path).replace(/\\/g, '/'));

describe('driver arrival frontend contract', () => {
  it('has one production RPC gateway, preventing legacy one-argument call sites', () => {
    expect(directRpcCallers).toEqual(['src/lib/driver/driverArrival.ts']);
  });

  it.each([
    'src/pages/driver/DriverStops.tsx',
    'src/pages/driver/DriverDeliveries.tsx',
  ])('%s delegates arrival to the shared GPS gateway', (path) => {
    const source = readFileSync(join(projectRoot, path), 'utf8');
    expect(source).toContain("import { markDriverArrival } from '@/lib/driver/driverArrival'");
    expect(source).toMatch(/markDriverArrival\([^)]*\.id|markDriverArrival\(stopId\)/);
  });

  it('keeps the generated Data API contract limited to GPS evidence', () => {
    const types = readFileSync(join(sourceRoot, 'integrations', 'supabase', 'types.ts'), 'utf8');
    const signature = types.match(/driver_mark_arrival:\s*\{[\s\S]*?Returns: string\s*\}/)?.[0];
    expect(signature).toBeDefined();
    expect(signature).toContain('_stop_id: string');
    expect(signature).toContain('_latitude: number');
    expect(signature).toContain('_longitude: number');
    expect(signature).toContain('_accuracy_m: number');
  });
});
