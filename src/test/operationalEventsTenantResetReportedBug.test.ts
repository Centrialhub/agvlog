import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');

describe('operational events tenant reset', () => {
  it('closes tenant-bound views and clears form, chat, filters and paging', () => {
    const effectStart = page.indexOf('useEffect(() => {', page.indexOf('const [form, setForm]'));
    const effectEnd = page.indexOf('}, [currentTenant?.id]);', effectStart);
    const effect = page.slice(effectStart, effectEnd);
    for (const reset of [
      'setSelectedEvent(null)', 'setDialogOpen(false)', 'setForm({ ...EMPTY_OPERATIONAL_EVENT_FORM })',
      'setChatDriver(null)', "setSearch('')", "setStatusFilter('open')", "setTypeFilter('all')",
      "setSeverityFilter('all')", "setVehicleFilter('all')", 'setDateFrom(undefined)', 'setDateTo(undefined)',
      "setDriverFilter('all')", "setClientFilter('all')", "setLoadFilter('all')", "setImpactMin('')",
      "setImpactMax('')", 'setHasImpactOnly(false)', "setRespFilter('all')", 'setAdvancedOpen(false)',
      "setDriverPanelSearch('')", 'setExpandedDriver(null)', 'setPage(1)',
    ]) expect(effect).toContain(reset);
  });
});
