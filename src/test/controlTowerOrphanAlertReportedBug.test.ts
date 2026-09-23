import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('control tower alert outside bounded trip snapshot',()=>{
  it('enriches alerts and opens a safe trip detail fallback',()=>{
    const migration=readFileSync('supabase/migrations/20260921192051_enrich_control_tower_alert_trips.sql','utf8');
    const panel=readFileSync('src/components/control-tower/AlertsPanel.tsx','utf8');
    expect(migration).toContain("'vehicle_plate',vehicle.plate");
    expect(migration).toContain('left join public.dispatch_trips trip');
    expect(panel).toContain('const selectableTrip=trip??alertTrip(a)');
    expect(panel).toContain('selectableTrip&&onSelectTrip(selectableTrip)');
  });
});
