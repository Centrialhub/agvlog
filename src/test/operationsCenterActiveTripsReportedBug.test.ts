import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TRIP_ACTIVE_STATUSES } from '@/lib/status';

describe('contagem de viagens ativas da central',()=>{
  it('usa a definição canônica completa',()=>{
    expect(TRIP_ACTIVE_STATUSES).toEqual(expect.arrayContaining(['planned','loading','dispatched','in_transit','in_progress']));
    const page=readFileSync('src/pages/OperationsCenter.tsx','utf8');
    expect(page).toContain(".in('status', TRIP_ACTIVE_STATUSES)");
    expect(page).not.toContain(".in('status', ['planned', 'in_progress'])");
  });
});
