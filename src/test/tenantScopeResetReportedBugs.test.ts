import { describe, expect, it } from 'vitest';

describe('bugs 1097, 1107 e 1108 de troca de empresa', () => {
  it('returns cargo custody and address resolution pagination to page one', async () => {
    const cargo = (await import('@/pages/TripCargoCustody?raw')).default;
    const addresses = (await import('@/pages/AddressResolution?raw')).default;
    expect(cargo).toMatch(/useEffect\(\(\) => \{\s*setPage\(1\);[^}]*setTripId\(null\)/);
    expect(cargo).toContain('}, [tenantId]);');
    expect(addresses).toMatch(/useEffect\(\(\) => \{\s*setPage\(1\);\s*setPageCursors\(\{ 1: null \}\);\s*snapshotRef\.current = null;/);
    expect(addresses).toContain('}, [tenantId]);');
  });

  it('closes and clears the operational route dialog when tenant changes', async () => {
    const routes = (await import('@/pages/OperationalRoutesPage?raw')).default;
    expect(routes).toContain('}, [currentTenant?.id]);');
    expect(routes).toContain('setEditingId(null)');
    expect(routes).toContain('setDialogOpen(false)');
    expect(routes).toContain("setForm({ name: '', description: '', classification: 'general'");
  });
});
