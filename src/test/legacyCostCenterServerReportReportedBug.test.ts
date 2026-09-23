import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260917151300_page_legacy_cost_center_report.sql','utf8');
const page=readFileSync('src/pages/LegacyCostCenters.tsx','utf8');

describe('legacy cost center bounded report',()=>{
 it('pushes date and cost-center filters into every source before paging',()=>{expect(migration.match(/_from is null or/g)).toHaveLength(5);expect(migration.match(/_cost_center is null or/g)).toHaveLength(5);expect(migration).toContain('limit _page_size offset (_page-1)*_page_size');});
 it('uses one server report and surfaces source failures',()=>{expect(page).toContain("'get_legacy_cost_center_report_v1'");expect(page).not.toContain('fetchAllPostgrestPages');expect(page).toContain('Nenhum total vazio foi inferido');expect(page).toContain('reportQuery.isError');});
 it('releases the CSV object URL after starting the download',()=>{expect(page).toContain('URL.revokeObjectURL(objectUrl)');});
});
