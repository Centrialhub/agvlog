import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('atualização contínua do dashboard do portal', () => {
  it.each([
    'usePortalSummary.ts',
    'usePortalUpcomingDeliveries.ts',
    'usePortalAlerts.ts',
  ])('configura polling visível em %s', (file) => {
    const source = readFileSync(`src/hooks/portal/${file}`, 'utf8');
    expect(source).toContain('refetchInterval: 60_000');
    expect(source).toContain('refetchIntervalInBackground: false');
  });
});
