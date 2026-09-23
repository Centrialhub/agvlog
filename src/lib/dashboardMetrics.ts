import { supabase } from '@/integrations/supabase/client';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import { APP_TIME_ZONE, localDateInputValue, shiftDateInputValue } from '@/lib/utils/formatDate';

export interface DashboardWeeklyMetric {
  day: string;
  vehicle_id: string;
  km_estimated: number | null;
  trips_count: number | null;
  overspeed_events: number | null;
  moving_time_seconds: number | null;
}

export function dashboardWeekStart(now: Date = new Date(), timeZone = APP_TIME_ZONE): string {
  return dashboardWeekStartFromCivilDay(localDateInputValue(now, timeZone));
}

export function dashboardWeekStartFromCivilDay(civilDay: string): string {
  return shiftDateInputValue(civilDay, -6);
}

export function readDashboardWeeklyMetrics(tenantId: string, fromDay: string, signal?: AbortSignal) {
  return fetchAllPostgrestPages<DashboardWeeklyMetric>((from, to) => supabase.from('metrics_daily')
    .select('day, vehicle_id, km_estimated, trips_count, overspeed_events, moving_time_seconds')
    .eq('tenant_id', tenantId)
    .gte('day', fromDay)
    .order('day')
    .order('vehicle_id')
    .range(from, to)
    .abortSignal(signal ?? new AbortController().signal));
}
