import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useDriverMonitoring.tsx','utf8');
const page=readFileSync('src/pages/DriverMonitoring.tsx','utf8');

describe('driver monitoring pagination',()=>{
  it('pages monitor rows and chunks dependent forecast reads',()=>{
    expect(hook).toContain('.range(from,from+DRIVER_MONITOR_PAGE_SIZE-1)');
    expect(hook).toContain('DRIVER_MONITOR_PAGE_SIZE=50');
    expect(hook).toContain(".in('monitor_id',ids)");
    expect(hook).toContain('start+=100');
    expect(page).toContain('<DataPagination {...monitorPagination}/>');
    expect(page).toContain('useMonitorForecasts(reportRows.map(row=>row.id))');
  });
});
