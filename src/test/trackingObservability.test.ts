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

  it('rejects incomplete envelopes and malformed values instead of displaying false zeroes', () => {
    expect(() => parseTrackingObservability(null)).toThrow(/envelope válido/);
    expect(() => parseTrackingObservability({ positions: {} })).toThrow(/tracker_links ausente/);
    expect(() => parseTrackingObservability({
      positions: { fresh: '4', stale: 2, last_at: null },
      tracker_links: {}, geofences: {}, queue: {}, addresses: {}, integration: {}, schedule: {},
    })).toThrow(/fresh inválido/);
  });

  it('rejects invalid timestamps and explicit invalid schedule intervals', () => {
    const base = {
      positions: { fresh: 0, stale: 0, last_at: null },
      tracker_links: { active: 0, conflicts: 0 },
      geofences: { fleet: 0, delivery: 0, events_24h: 0, last_evaluated_at: null },
      queue: { pending: 0, errors: 0 }, addresses: { pending: 0, ambiguous: 0, error: 0 },
      integration: {}, schedule: {},
    };
    expect(() => parseTrackingObservability({ ...base, positions: { ...base.positions, last_at: 'not-a-date' } })).toThrow(/data válida/);
    expect(() => parseTrackingObservability({ ...base, schedule: { poll_interval_minutes: 0 } })).toThrow(/poll_interval_minutes/);
  });
});
