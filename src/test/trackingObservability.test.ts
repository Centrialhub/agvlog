import { describe, expect, it } from 'vitest';
import { parseTrackingObservability } from '@/lib/trackingObservability';

describe('tracking observability parser', () => {
  it('normalizes the real database payload without trusting malformed values', () => {
    const parsed = parseTrackingObservability({
      positions: { fresh: 4, stale: 2, last_at: '2026-09-10T12:00:00Z' },
      tracker_links: { active: 5, conflicts: 1 },
      geofences: { fleet: 2, delivery: 8, events_24h: 7, last_evaluated_at: '2026-09-10T12:01:00Z' },
      queue: { pending: 3, errors: 1 },
      addresses: { pending: 6, ambiguous: 2, error: 1 },
      integration: { last_at: '2026-09-10T12:00:00Z', success: false, action: 'ssx_poll_positions', error: 'rate_limited' },
      schedule: { enabled: true, poll_interval_minutes: 3, full_sync_interval_hours: 6, last_finished_at: null,
        last_status: 'partial', consecutive_failures: 2 },
    });
    expect(parsed.positions).toEqual({ fresh: 4, stale: 2, lastAt: '2026-09-10T12:00:00Z' });
    expect(parsed.trackerLinks).toEqual({ active: 5, conflicts: 1 });
    expect(parsed.geofences.delivery).toBe(8);
    expect(parsed.addresses.ambiguous).toBe(2);
    expect(parsed.integration).toMatchObject({ success: false, action: 'ssx_poll_positions', error: 'rate_limited' });
    expect(parsed.schedule).toMatchObject({ enabled: true, pollMinutes: 3, fullSyncHours: 6, consecutiveFailures: 2 });
  });

  it('fails closed to empty metrics when the payload is missing', () => {
    const parsed = parseTrackingObservability(null);
    expect(parsed.positions.fresh).toBe(0);
    expect(parsed.integration.success).toBeNull();
    expect(parsed.schedule.enabled).toBe(false);
  });
});
