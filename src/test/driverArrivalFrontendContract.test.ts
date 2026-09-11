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

  it('keeps the delivery screen on the durable shared GPS gateway', () => {
    const source = readFileSync(join(projectRoot, 'src/pages/driver/DriverDeliveries.tsx'), 'utf8');
    expect(source).toContain("import { getCurrentDriverLocation } from '@/lib/driverLocation'");
    expect(source).toContain('const operationalCommands = useDriverOperationalOffline()');
    expect(source).toContain("operationalCommands.submit({kind:'arrival'");
    expect(source).toContain('latitude:location.latitude');
    expect(source).toContain('longitude:location.longitude');
    expect(source).toContain('accuracy_m:location.accuracyM');
  });

  it('captures GPS evidence before queuing an idempotent arrival from the stops screen', () => {
    const source = readFileSync(join(projectRoot, 'src/pages/driver/DriverStops.tsx'), 'utf8');
    expect(source).toContain("import { getCurrentDriverLocation } from '@/lib/driverLocation'");
    expect(source).toContain('const location = await getCurrentDriverLocation()');
    expect(source).toContain("kind: 'arrival'");
    expect(source).toContain('latitude: location.latitude');
    expect(source).toContain('longitude: location.longitude');
    expect(source).toContain('accuracy_m: location.accuracy');
  });

  it('keeps offline arrival replay behind the server-side GPS gateway', () => {
    const migration = readFileSync(
      join(projectRoot, 'supabase/migrations/20260910154758_driver_operational_offline_commands.sql'),
      'utf8',
    );
    expect(migration).toMatch(/when 'arrival'[\s\S]*?public\.driver_mark_arrival\(/);
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
