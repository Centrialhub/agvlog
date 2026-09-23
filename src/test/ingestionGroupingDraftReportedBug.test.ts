import { describe, expect, it } from 'vitest';
import { groupingDraftKey, restoreGroupingAssignments } from '@/lib/ingestion/groupingDraft';

const snapshot = [{ region: 'Sul', docs: [{ invoiceNumber: '10' }] }];
const saved = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  ts: 1_000,
  suggestionsSnapshot: snapshot,
  assignments: [[0, { vehicleId: 'vehicle-1', driverId: 'driver-1' }]],
  ...overrides,
});

describe('ingestion grouping draft isolation', () => {
  it('scopes storage by tenant and actor', () => {
    expect(groupingDraftKey('tenant-a', 'user-a')).not.toBe(groupingDraftKey('tenant-b', 'user-a'));
    expect(groupingDraftKey('tenant-a', 'user-a')).not.toBe(groupingDraftKey('tenant-a', 'user-b'));
  });

  it('restores only the exact batch with current vehicle and driver ids', () => {
    expect(restoreGroupingAssignments(saved(), snapshot, 1, new Set(['vehicle-1']), new Set(['driver-1']), 2_000)?.get(0))
      .toEqual({ vehicleId: 'vehicle-1', driverId: 'driver-1' });
    expect(restoreGroupingAssignments(saved({ suggestionsSnapshot: [{ region: 'Norte' }] }), snapshot, 1, new Set(['vehicle-1']), new Set(['driver-1']), 2_000)).toBeNull();
    expect(restoreGroupingAssignments(saved(), snapshot, 1, new Set(), new Set(['driver-1']), 2_000)).toBeNull();
  });
});
