import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921133500_return_complete_portal_report_dimensions.sql',
  'utf8',
);
const page = readFileSync('src/pages/portal/PortalReports.tsx', 'utf8');

describe('portal report dimension truncation regression', () => {
  it('removes both silent limits from the canonical report reader', () => {
    expect(migration).toContain("v_occurrence_limit text := E'    order by total desc\\n    limit 20'");
    expect(migration).toContain("v_city_limit text := E'    order by total desc\\n    limit 15'");
    expect(migration).toContain('replace(v_function, v_occurrence_limit, v_order_only)');
    expect(migration).toContain('replace(v_function, v_city_limit, v_order_only)');
    expect(migration).toContain('portal_report_dimension_limit_contract_not_found');
  });

  it('exports the same complete arrays rendered in both reports', () => {
    expect(page).toContain('rows={data.occurrences_by_type.map');
    expect(page).toContain('rows={data.top_cities.map');
    expect(page).toContain('downloadCsv(csvName, rows)');
  });
});
