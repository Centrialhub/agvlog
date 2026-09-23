import { describe, expect, it } from 'vitest';
import { detectDelayedRoute } from '@/lib/driverMonitoring/driverMonitoringCalculator';

const monitor={total_deliveries:2,completed_deliveries:1,expected_return_date:'2026-06-01'};

describe('driver monitoring frontend tenant timezone',()=>{
  it('compares the due date with the tenant civil date, not the browser timezone',()=>{
    const instant=new Date('2026-06-02T01:00:00.000Z');
    expect(detectDelayedRoute(monitor,instant,'America/Sao_Paulo')).toBe(false);
    expect(detectDelayedRoute(monitor,instant,'Asia/Tokyo')).toBe(true);
  });
});
