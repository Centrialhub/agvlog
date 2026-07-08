import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import {
  calculateCompletedDeliveries, calculateProgressPercent, calculateRemainingDeliveries,
  calculateDriverStatus, type DriverMonitorStatus,
} from '@/lib/driverMonitoring/driverMonitoringCalculator';
import type {
  ParsedDriverMonitoringWorkbook, ParsedMonitor, ParsedForecast,
} from '@/lib/driverMonitoring/driverMonitoringSpreadsheetImport';

export interface DriverMonitorRow {
  id: string;
  tenant_id: string;
  monitor_number: string;
  driver_id: string | null;
  driver_name_snapshot: string | null;
  vehicle_id: string | null;
  vehicle_plate_snapshot: string | null;
  load_id: string | null;
  load_number: string | null;
  planned_route_text: string | null;
  planned_cities: string[];
  started_at: string | null;
  expected_return_date: string | null;
  return_deadline_days: number | null;
  actual_returned_at: string | null;
  total_deliveries: number;
  completed_deliveries: number;
  remaining_deliveries: number;
  progress_percent: number;
  current_city: string | null;
  next_city: string | null;
  remaining_cities: string[];
  arrival_forecast_text: string | null;
  arrival_forecast_at: string | null;
  status: DriverMonitorStatus | string;
  last_update_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface ProgressUpdateRow {
  id: string;
  monitor_id: string;
  driver_name?: string | null;
  update_date: string;
  update_time: string | null;
  city: string | null;
  deliveries_completed_in_city: number;
  city_finished_at: string | null;
  next_city: string | null;
  next_city_deliveries: number | null;
  observation: string | null;
  status: string | null;
}

export interface ForecastRow {
  id: string;
  monitor_id: string;
  driver_name?: string | null;
  forecast_date: string;
  forecast_time: string | null;
  current_city: string | null;
  forecast_text: string | null;
  remaining_cities_text: string | null;
  observation: string | null;
  status: string;
  forecast_arrival_at: string | null;
}

export interface DriverMonitoringFilters {
  driverId?: string | null;
  vehicleId?: string | null;
  plate?: string | null;
  status?: string | null;
  currentCity?: string | null;
  nextCity?: string | null;
  onlyDelayed?: boolean;
  onlyNoUpdate?: boolean;
  loadId?: string | null;
  startedFrom?: string | null;
  startedTo?: string | null;
}

function toRow(m: any): DriverMonitorRow {
  const completed = Number(m.completed_deliveries || 0);
  const total = Number(m.total_deliveries || 0);
  const remaining = calculateRemainingDeliveries(total, completed);
  return {
    id: m.id,
    tenant_id: m.tenant_id,
    monitor_number: m.monitor_number,
    driver_id: m.driver_id,
    driver_name_snapshot: m.driver_name_snapshot || m.drivers?.name || null,
    vehicle_id: m.vehicle_id,
    vehicle_plate_snapshot: m.vehicle_plate_snapshot || m.vehicles?.license_plate || null,
    load_id: m.load_id,
    load_number: m.loads?.load_number || m.loads?.external_load_number || null,
    planned_route_text: m.planned_route_text,
    planned_cities: Array.isArray(m.planned_cities) ? m.planned_cities : [],
    started_at: m.started_at,
    expected_return_date: m.expected_return_date,
    return_deadline_days: m.return_deadline_days,
    actual_returned_at: m.actual_returned_at,
    total_deliveries: total,
    completed_deliveries: completed,
    remaining_deliveries: remaining,
    progress_percent: calculateProgressPercent(total, completed),
    current_city: m.current_city,
    next_city: m.next_city,
    remaining_cities: Array.isArray(m.remaining_cities) ? m.remaining_cities : [],
    arrival_forecast_text: m.arrival_forecast_text,
    arrival_forecast_at: m.arrival_forecast_at,
    status: m.status,
    last_update_at: m.last_update_at,
    notes: m.notes,
    updated_at: m.updated_at,
  };
}

export function useDriverMonitorsList(filters: DriverMonitoringFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-monitors', currentTenant?.id, filters],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      let q = supabase.from('driver_route_monitors')
        .select('*, drivers:driver_id(name), vehicles:vehicle_id(license_plate), loads:load_id(load_number, external_load_number)')
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false });
      if (filters.driverId) q = q.eq('driver_id', filters.driverId);
      if (filters.vehicleId) q = q.eq('vehicle_id', filters.vehicleId);
      if (filters.loadId) q = q.eq('load_id', filters.loadId);
      if (filters.status) q = q.eq('status', filters.status);
      if (filters.currentCity) q = q.ilike('current_city', `%${filters.currentCity}%`);
      if (filters.nextCity) q = q.ilike('next_city', `%${filters.nextCity}%`);
      if (filters.plate) q = q.ilike('vehicle_plate_snapshot', `%${filters.plate}%`);
      if (filters.startedFrom) q = q.gte('started_at', filters.startedFrom);
      if (filters.startedTo) q = q.lte('started_at', filters.startedTo);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data || []).map(toRow);
      if (filters.onlyDelayed) rows = rows.filter((r) => r.status === 'delayed');
      if (filters.onlyNoUpdate) rows = rows.filter((r) => r.status === 'no_update');
      return rows;
    },
  });
}

export function useMonitorUpdates(monitorId: string | null | undefined) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-monitor-updates', monitorId],
    enabled: !!monitorId && !!currentTenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('driver_route_progress_updates')
        .select('*, drivers:driver_id(name)')
        .eq('monitor_id', monitorId!)
        .order('update_date', { ascending: true });
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r, driver_name: r.drivers?.name,
      })) as ProgressUpdateRow[];
    },
  });
}

export function useMonitorForecasts(monitorId?: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-arrival-forecasts', monitorId, currentTenant?.id],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      let q = supabase.from('driver_arrival_forecasts')
        .select('*, drivers:driver_id(name)')
        .eq('tenant_id', currentTenant!.id)
        .order('forecast_date', { ascending: false });
      if (monitorId) q = q.eq('monitor_id', monitorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map((r: any) => ({ ...r, driver_name: r.drivers?.name })) as ForecastRow[];
    },
  });
}

export function useCreateMonitor() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<DriverMonitorRow> & { monitor_number?: string }) => {
      const tenantId = currentTenant!.id;
      const monitor_number = payload.monitor_number || `MON-${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await supabase.from('driver_route_monitors').insert({
        tenant_id: tenantId,
        monitor_number,
        driver_id: payload.driver_id || null,
        vehicle_id: payload.vehicle_id || null,
        load_id: payload.load_id || null,
        driver_name_snapshot: payload.driver_name_snapshot || null,
        vehicle_plate_snapshot: payload.vehicle_plate_snapshot || null,
        planned_route_text: payload.planned_route_text || null,
        planned_cities: payload.planned_cities || [],
        started_at: payload.started_at || new Date().toISOString(),
        expected_return_date: payload.expected_return_date || null,
        return_deadline_days: payload.return_deadline_days || null,
        total_deliveries: payload.total_deliveries || 0,
        completed_deliveries: 0,
        remaining_deliveries: payload.total_deliveries || 0,
        current_city: payload.current_city || null,
        next_city: payload.next_city || null,
        notes: payload.notes || null,
        status: 'active',
        source_type: 'manual',
      }).select().single();
      if (error) throw error;
      await supabase.from('driver_monitoring_history').insert({
        tenant_id: tenantId, monitor_id: data.id, action: 'created',
        new_value: monitor_number,
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-monitors'] }),
  });
}

export function useAddProgressUpdate() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      monitor_id: string;
      update_date: string;
      city?: string | null;
      deliveries_completed_in_city?: number;
      next_city?: string | null;
      next_city_deliveries?: number | null;
      city_finished_at?: string | null;
      observation?: string | null;
    }) => {
      const tenantId = currentTenant!.id;
      const { data: monitor, error: eM } = await supabase.from('driver_route_monitors')
        .select('*').eq('id', payload.monitor_id).single();
      if (eM) throw eM;

      const { error } = await supabase.from('driver_route_progress_updates').insert({
        tenant_id: tenantId,
        monitor_id: payload.monitor_id,
        driver_id: monitor.driver_id,
        load_id: monitor.load_id,
        update_date: payload.update_date,
        city: payload.city || null,
        deliveries_completed_in_city: Math.max(0, Number(payload.deliveries_completed_in_city || 0)),
        next_city: payload.next_city || null,
        next_city_deliveries: payload.next_city_deliveries ?? null,
        city_finished_at: payload.city_finished_at || null,
        observation: payload.observation || null,
        source_type: 'manual',
      });
      if (error) throw error;

      const { data: updates } = await supabase.from('driver_route_progress_updates')
        .select('deliveries_completed_in_city, update_date, observation, status, created_at')
        .eq('monitor_id', payload.monitor_id);
      const completed = calculateCompletedDeliveries(updates || []);
      const total = Number(monitor.total_deliveries || 0);
      const remaining = calculateRemainingDeliveries(total, completed);
      const newStatus = calculateDriverStatus(
        { ...(monitor as any), completed_deliveries: completed, last_update_at: new Date().toISOString(), remaining_cities: [] },
        (updates || []) as any,
      );
      await supabase.from('driver_route_monitors').update({
        completed_deliveries: completed,
        remaining_deliveries: remaining,
        current_city: payload.city || monitor.current_city,
        next_city: payload.next_city || monitor.next_city,
        last_update_at: new Date().toISOString(),
        status: newStatus,
      }).eq('id', payload.monitor_id);

      await supabase.from('driver_monitoring_history').insert({
        tenant_id: tenantId, monitor_id: payload.monitor_id,
        action: 'progress_update', new_value: `${payload.city ?? ''} (+${payload.deliveries_completed_in_city ?? 0})`,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-monitors'] });
      qc.invalidateQueries({ queryKey: ['driver-monitor-updates'] });
    },
  });
}

export function useAddForecast() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      monitor_id: string;
      forecast_date: string;
      forecast_time?: string | null;
      current_city?: string | null;
      forecast_text?: string | null;
      remaining_cities_text?: string | null;
      observation?: string | null;
    }) => {
      const tenantId = currentTenant!.id;
      const { data: monitor } = await supabase.from('driver_route_monitors')
        .select('driver_id').eq('id', payload.monitor_id).single();
      const { error } = await supabase.from('driver_arrival_forecasts').insert({
        tenant_id: tenantId,
        monitor_id: payload.monitor_id,
        driver_id: monitor?.driver_id || null,
        forecast_date: payload.forecast_date,
        forecast_time: payload.forecast_time || null,
        current_city: payload.current_city || null,
        forecast_text: payload.forecast_text || null,
        remaining_cities_text: payload.remaining_cities_text || null,
        observation: payload.observation || null,
        status: 'active',
      });
      if (error) throw error;
      await supabase.from('driver_route_monitors').update({
        arrival_forecast_text: payload.forecast_text || null,
        current_city: payload.current_city || undefined,
      }).eq('id', payload.monitor_id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-monitors'] });
      qc.invalidateQueries({ queryKey: ['driver-arrival-forecasts'] });
    },
  });
}

export function useUpdateMonitorStatus() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reason, actual_returned_at }: {
      id: string; status: string; reason?: string; actual_returned_at?: string;
    }) => {
      const patch: any = { status };
      if (actual_returned_at) patch.actual_returned_at = actual_returned_at;
      const { error } = await supabase.from('driver_route_monitors').update(patch).eq('id', id);
      if (error) throw error;
      await supabase.from('driver_monitoring_history').insert({
        tenant_id: currentTenant!.id, monitor_id: id, action: 'status_changed',
        new_value: status, reason: reason || null,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driver-monitors'] }),
  });
}

export function useMonitorHistory(monitorId?: string | null) {
  return useQuery({
    queryKey: ['driver-monitoring-history', monitorId],
    enabled: !!monitorId,
    queryFn: async () => {
      const { data, error } = await supabase.from('driver_monitoring_history')
        .select('*').eq('monitor_id', monitorId!).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useImportDriverMonitoringWorkbook() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, parsed }: { file: File; parsed: ParsedDriverMonitoringWorkbook }) => {
      const tenantId = currentTenant!.id;
      // Find existing drivers by name (case-insensitive).
      const names = Array.from(new Set([
        ...parsed.monitors.map((m) => m.driver_name),
        ...parsed.forecasts.map((f) => f.driver_name || ''),
      ].filter(Boolean)));
      const { data: driversData } = await supabase.from('drivers')
        .select('id, name').eq('tenant_id', tenantId);
      const findDriver = (n: string | null) => {
        if (!n) return null;
        const norm = n.trim().toLowerCase();
        return (driversData || []).find((d: any) => (d.name || '').toLowerCase() === norm) || null;
      };

      const { data: batch, error: eB } = await supabase.from('driver_monitoring_import_batches').insert({
        tenant_id: tenantId,
        file_name: file.name,
        row_count: parsed.monitors.length + parsed.forecasts.length,
        status: 'processing',
        errors: parsed.errors as any,
      }).select().single();
      if (eB) throw eB;

      let importedMonitors = 0;
      let importedUpdates = 0;
      let importedForecasts = 0;
      const errors: string[] = [...parsed.errors];

      const monitorByName = new Map<string, string>();

      for (const m of parsed.monitors as ParsedMonitor[]) {
        const driver = findDriver(m.driver_name);
        if (!driver) errors.push(`Motorista não encontrado: ${m.driver_name}`);
        const monitor_number = `IMP-${Date.now().toString(36).toUpperCase()}-${importedMonitors + 1}`;
        const { data: mon, error: eM } = await supabase.from('driver_route_monitors').insert({
          tenant_id: tenantId,
          monitor_number,
          driver_id: driver?.id || null,
          driver_name_snapshot: m.driver_name,
          planned_route_text: m.planned_route_text,
          planned_cities: m.planned_cities as any,
          total_deliveries: m.total_deliveries,
          completed_deliveries: 0,
          remaining_deliveries: m.total_deliveries,
          return_deadline_days: m.return_deadline_days,
          status: 'active',
          source_type: 'spreadsheet_import',
          import_batch_id: batch.id,
          started_at: new Date().toISOString(),
        }).select().single();
        if (eM) { errors.push(`Erro monitor ${m.driver_name}: ${eM.message}`); continue; }
        importedMonitors++;
        monitorByName.set(m.driver_name.toLowerCase(), mon.id);

        if (m.updates.length) {
          const rows = m.updates
            .filter((u) => u.update_date)
            .map((u) => ({
              tenant_id: tenantId,
              monitor_id: mon.id,
              driver_id: driver?.id || null,
              update_date: u.update_date!,
              city: u.city,
              deliveries_completed_in_city: Math.max(0, u.deliveries_completed_in_city || 0),
              next_city: u.next_city,
              next_city_deliveries: u.next_city_deliveries,
              city_finished_at: u.city_finished_at,
              deadline_to_finish: u.deadline_to_finish,
              observation: u.observation,
              status: u.status,
              source_type: 'spreadsheet_import',
            }));
          if (rows.length) {
            const { error: eU } = await supabase.from('driver_route_progress_updates').insert(rows);
            if (eU) errors.push(`Erro atualizações ${m.driver_name}: ${eU.message}`);
            else importedUpdates += rows.length;
          }

          const completed = rows.reduce((s, r) => s + r.deliveries_completed_in_city, 0);
          const remaining = calculateRemainingDeliveries(m.total_deliveries, completed);
          const last = rows[rows.length - 1];
          await supabase.from('driver_route_monitors').update({
            completed_deliveries: completed,
            remaining_deliveries: remaining,
            current_city: last?.city || null,
            next_city: last?.next_city || null,
            last_update_at: new Date().toISOString(),
          }).eq('id', mon.id);
        }
      }

      for (const f of parsed.forecasts as ParsedForecast[]) {
        const monId = monitorByName.get((f.driver_name || '').toLowerCase());
        if (!monId || !f.forecast_date) {
          errors.push(`Previsão sem monitor: ${f.driver_name || '(sem motorista)'}`);
          continue;
        }
        const driver = findDriver(f.driver_name);
        const { error: eF } = await supabase.from('driver_arrival_forecasts').insert({
          tenant_id: tenantId,
          monitor_id: monId,
          driver_id: driver?.id || null,
          forecast_date: f.forecast_date,
          forecast_time: f.forecast_time,
          current_city: f.current_city,
          forecast_text: f.forecast_text,
          remaining_cities_text: f.remaining_cities_text,
          remaining_cities: f.remaining_cities as any,
          observation: f.observation,
          status: 'active',
        });
        if (eF) errors.push(`Erro previsão ${f.driver_name}: ${eF.message}`);
        else importedForecasts++;
      }

      await supabase.from('driver_monitoring_import_batches').update({
        imported_monitors: importedMonitors,
        imported_updates: importedUpdates,
        imported_forecasts: importedForecasts,
        error_count: errors.length,
        status: errors.length ? 'completed_with_errors' : 'completed',
        errors: errors as any,
      }).eq('id', batch.id);

      return { importedMonitors, importedUpdates, importedForecasts, errors };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-monitors'] });
      qc.invalidateQueries({ queryKey: ['driver-arrival-forecasts'] });
    },
  });
}