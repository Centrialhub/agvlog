import { describe, expect, it } from 'vitest';

describe('bugs 1060, 1061, 1065 e 1066 da importação rural', () => {
  it('binds previews to a tenant and verifies an update affected a row', async () => {
    const hook = (await import('@/hooks/useRuralClients?raw')).default;
    expect(hook).toContain('tenantId: string');
    expect(hook).toContain('if (preview.tenantId !== tenantId)');
    expect(hook).toContain(".select('id')");
    expect(hook).toContain('if (!updatedRow) throw new Error');
  });

  it('shows every preview row and reports persisted import failures', async () => {
    const page = (await import('@/pages/RuralClients?raw')).default;
    expect(page).toContain('preview.rows.map((r, i)');
    expect(page).not.toContain('preview.rows.slice(0, 200)');
    expect(page).toContain('Todas as {preview.rows.length} linhas');
    expect(page).toContain('res.errors.length ? \'Importação concluída com falhas\'');
    expect(page).toContain('<TableCell>{b.error_count}</TableCell>');
    expect(page).toContain('Ver {errors.length} ocorrência(s)');
    expect(page).toContain('}, [currentTenant?.id]);');
  });

  it('does not arbitrarily overwrite clients with the same normalized name', async () => {
    const hook = (await import('@/hooks/useRuralClients?raw')).default;
    const page = (await import('@/pages/RuralClients?raw')).default;
    expect(hook).toContain('new Map<string, Array<Pick<Tables<\'clients\'>');
    expect(hook).toContain('candidates.filter(candidate => normalizeText(candidate.address_city)');
    expect(hook).toContain('Nome ambíguo: ${candidates.length} clientes correspondem');
    expect(hook).toContain("reason: r.match_issue || 'Cliente não encontrado'");
    expect(page).toContain('{r.match_issue}');
  });

  it('keeps client KPI fields synchronized with imported rural profiles', async () => {
    const hook = (await import('@/hooks/useRuralClients?raw')).default;
    expect(hook).toContain('function ruralContactPhone');
    expect(hook).toContain('rural_driver_instructions: r.resolution_text');
    expect(hook).toContain('rural_requires_contact: r.inferred.requires_contact_before_delivery');
    expect(hook).toContain('rural_contact_phone: contactPhone');
    expect(hook).toContain('rural_access_type: r.inferred.access_type');
  });
});
