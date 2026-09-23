import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('control tower truncated snapshot',()=>{
  it('shows the real total, labels partial KPIs, and blocks partial bulk calculation',()=>{
    const page=readFileSync('src/pages/OperationsControl.tsx','utf8');
    const kpis=readFileSync('src/components/control-tower/KpiCards.tsx','utf8');
    expect(page).toContain('tripQuery.data?.trip_total??trips.length');
    expect(page).toContain('Exibindo {trips.length} de {tripQuery.data!.trip_total}');
    expect(page).toContain('trips.length === 0 || tripsTruncated');
    expect(kpis).toContain("truncated?'Normais no lote':'Normais'");
  });
});
