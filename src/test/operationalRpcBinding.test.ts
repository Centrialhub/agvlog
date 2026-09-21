import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const clients = [
  'src/hooks/useDriverOperationalOffline.ts',
  'src/lib/driver/driverDeliveryFiscalSnapshot.ts',
  'src/lib/driver/tripCargoCustody.ts',
  'src/lib/operationalEvents/operatorEventCommands.ts',
  'src/lib/route-planning/draftDeleteCommand.ts',
];

describe('operational RPC clients', () => {
  it.each(clients)('keeps the Supabase SDK receiver in %s', file => {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain('supabase.rpc.bind(supabase)');
    expect(source).not.toMatch(/const rpc\s*=\s*supabase\.rpc\s+as/);
  });
});
