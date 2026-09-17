import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useDriverMonitoring.tsx','utf8');
const page=readFileSync('src/pages/DriverMonitoring.tsx','utf8');

describe('bounded driver monitoring reads',()=>{
  it('pages monitor rows and scopes dependent history',()=>{
    expect(hook).not.toContain('fetchAllPostgrestPages');
    expect(hook).toContain('DRIVER_MONITOR_PAGE_SIZE=50');
    expect(hook).toContain(".in('monitor_id',monitorIds)");
    expect(hook).toContain('.limit(200)');
    expect(page).toContain('<DataPagination {...monitorPagination}/>');
    expect(page).toContain('useMonitorForecasts(rows.map(row=>row.id))');
  });
});
