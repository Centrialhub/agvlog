import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasDuplicateRouteDestinations } from '@/hooks/useOperationalRoutes';

const page = readFileSync('src/pages/OperationalRoutesPage.tsx', 'utf8');
const hook = readFileSync('src/hooks/useOperationalRoutes.tsx', 'utf8');
const migration = readFileSync(
  'supabase/migrations/20260922020000_reject_duplicate_operational_route_destinations.sql',
  'utf8',
);

describe('operational route destination uniqueness', () => {
  it('recognizes accents, case, spacing and mixed legacy shapes as the same city', () => {
    expect(hasDuplicateRouteDestinations(['  São   Paulo ', { name: 'sao paulo' }])).toBe(true);
    expect(hasDuplicateRouteDestinations([{ name: 'Contagem' }, { name: 'Betim' }])).toBe(false);
  });

  it('blocks duplicates in the editor, both hooks and the database', () => {
    expect(page).toContain("toast.error('Esta cidade já foi adicionada à rota.')");
    expect(hook.match(/hasDuplicateRouteDestinations\(values\.destinations\)/g)).toHaveLength(2);
    expect(migration).toContain('group by destination.city_key');
    expect(migration).toContain('having count(*)>1');
    expect(migration).toContain("raise exception 'duplicate_operational_route_destination'");
  });
});
