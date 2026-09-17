import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const page=readFileSync('src/pages/VehicleDetails.tsx','utf8');

describe('vehicle alert and geofence history bounds',()=>{
 it('does not request either history while the overview tab is active',()=>{expect(page).toContain("activeTab==='alerts'");expect(page).toContain("activeTab==='geofences'");expect(page).toContain('value={activeTab}');});
 it('uses server pages instead of draining both histories',()=>{expect(page).toContain("select('*, alert_rules(rule_type)',{count:'exact'})");expect(page).toContain("select('*, geofences(name)',{count:'exact'})");expect(page).toContain('detailPageSize=30');expect(page).not.toMatch(/vehicle_alerts[\s\S]{0,500}fetchAllPostgrestPages/);expect(page).not.toMatch(/vehicle_geo_events[\s\S]{0,500}fetchAllPostgrestPages/);});
});
