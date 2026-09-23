import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  ranges: [] as Array<[number, number]>,
  orders: [] as string[],
  fromDay: '',
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => {
      let from = 0;
      let to = 499;
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: (_field: string, value: string) => { mocks.fromDay = value;return builder; },
        order: (field: string) => { mocks.orders.push(field);return builder; },
        range: (start: number, end: number) => { from = start;to = end;mocks.ranges.push([start, end]);return builder; },
        abortSignal: async () => ({ data: mocks.rows.slice(from, to + 1), error: null }),
      };
      return builder;
    },
  },
}));

import { dashboardWeekStart, readDashboardWeeklyMetrics } from '@/lib/dashboardMetrics';

beforeEach(() => {
  mocks.rows = [];
  mocks.ranges = [];
  mocks.orders = [];
  mocks.fromDay = '';
});

describe('dashboard weekly metrics', () => {
  it('reads every PostgREST page with a stable unique order', async () => {
    mocks.rows = Array.from({ length: 501 }, (_, index) => ({
      day: '2026-09-21', vehicle_id: crypto.randomUUID(), km_estimated: index,
      trips_count: 1, overspeed_events: 0, moving_time_seconds: 60,
    }));

    await expect(readDashboardWeeklyMetrics('tenant-a', '2026-09-15')).resolves.toHaveLength(501);
    expect(mocks.ranges).toEqual([[0, 499], [500, 999]]);
    expect(mocks.orders).toEqual(['day', 'vehicle_id', 'day', 'vehicle_id']);
  });

  it('derives the seven-day boundary from the Sao Paulo civil date', () => {
    expect(dashboardWeekStart(new Date('2026-09-17T00:30:00.000Z'))).toBe('2026-09-10');
    expect(dashboardWeekStart(new Date('2026-09-17T00:30:00.000Z'), 'UTC')).toBe('2026-09-11');
  });
});
