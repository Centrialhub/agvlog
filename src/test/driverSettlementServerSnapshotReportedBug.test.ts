import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('snapshot dos acertos de motoristas', () => {
  it('deixa o servidor criar o snapshot inicial e o reutiliza somente ao paginar', () => {
    const page = readFileSync('src/pages/DriverSettlements.tsx', 'utf8');
    expect(page).toContain('useState<string | undefined>()');
    expect(page).toContain('setSnapshotAt(data.snapshot_at)');
    expect(page).toContain('setSnapshotAt(undefined)');
    expect(page).not.toContain('setSnapshotAt(new Date().toISOString())');
    expect(page).not.toContain('useState(() => new Date().toISOString())');
  });
});
