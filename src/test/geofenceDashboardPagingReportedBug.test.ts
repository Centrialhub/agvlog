import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=readFileSync('supabase/migrations/20260917151200_bound_geofence_dashboard.sql','utf8');
const page=readFileSync('src/pages/Geofences.tsx','utf8');

describe('bounded geofence dashboard',()=>{
 it('filters and pages geofences before returning map data',()=>{expect(migration).toContain('page_rows as materialized');expect(migration).toContain('limit _page_size offset (_page-1)*_page_size');expect(migration).toContain('limit 201');expect(migration).toContain("'positions_truncated'");});
 it('uses the bounded server projection instead of full-table browser loops',()=>{expect(page).toContain("'get_geofence_dashboard_v1'");expect(page).toContain('PAGE_SIZE=30');expect(page).not.toContain('fetchAllPostgrestPages');expect(page).not.toContain('useFleetPositions');expect(page).not.toContain('useVehicles');});
});
