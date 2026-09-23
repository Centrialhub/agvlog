import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('driver settlement list snapshot error regression', () => {
  it('maps the list RPC conflict before parsing its response', () => {
    const source = readFileSync('src/hooks/useDriverSettlements.tsx', 'utf8');
    const listHook = source.slice(
      source.indexOf('export function useDriverSettlements('),
      source.indexOf('const settlementFilterRevisions'),
    );

    expect(listHook).toContain("error.code === '40001'");
    expect(listHook).toContain("error.message.includes('settlement_snapshot_changed')");
    expect(listHook).toContain('throw new DriverSettlementSnapshotChangedError');
  });
});
