import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/OperationalEvents.tsx','utf8');

describe('relatório operacional por motorista',()=>{
  it('conta somente cargas entregues e suas NF-es reais',()=>{
    expect(page).toContain(".eq('status', 'delivered')");
    expect(page).toContain(".from('load_documents')");
    expect(page).toContain(".eq('document_type','nfe')");
    expect(page).toContain("notas += notesByLoad.get(l.id)?.size || 0");
    expect(page).not.toContain(".limit(5000)");
  });

  it('mantém homônimos separados pela identidade do motorista',()=>{
    expect(page).toContain('function operationalEventDriverKey');
    expect(page).toContain('const id = operationalEventDriverKey(e)');
    expect(page).toContain('eventsByDriver.get(r.id)');
    expect(page).toContain('exportReport({ driverId: r.id');
  });

  it('calcula totais somente para os mesmos 12 meses desenhados',()=>{
    expect(page).toContain('const monthKeys = new Set(months.map((month) => month.key))');
    expect(page).toContain('events.filter(e => monthKeys.has(operationalEventMonthKey(e.created_at, tenantTimezone)))');
  });
});
