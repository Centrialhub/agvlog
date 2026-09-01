import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import {
  calculateCompletedDeliveries, calculateProgressPercent, calculateRemainingDeliveries,
  calculateDriverStatus, type DriverMonitorStatus,
} from '@/lib/driverMonitoring/driverMonitoringCalculator';
import type {
  ParsedDriverMonitoringWorkbook, ParsedMonitor, ParsedForecast,
} from '@/lib/driverMonitoring/driverMonitoringSpreadsheetImport';
import {
  driverMonitorCommandError,
  type DriverMonitorCommandInput,
  type DriverMonitorCommandResult,
} from '@/lib/driverMonitoring/driverMonitorCommands';
import {
  createDriverMonitorOutbox,
  DRIVER_MONITOR_COMMAND_CHANGED,
  pendingDriverMonitorCommand,
} from '@/lib/driverMonitoring/driverMonitorOutbox';

type DriverMonitorDbRow = Database['public']['Tables']['driver_route_monitors']['Row'];
type DriverMonitorQueryRow = DriverMonitorDbRow & {
  drivers: { name: string } | null;
  vehicles: { plate: string } | null;
  loads: { load_number: string; external_load_number: string | null } | null;
};

function toStringArray(value: Json | null | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

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
  revision: number;
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

function toRow(m: DriverMonitorQueryRow): DriverMonitorRow {
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
    vehicle_plate_snapshot: m.vehicle_plate_snapshot || m.vehicles?.plate || null,
    load_id: m.load_id,
    load_number: m.loads?.load_number || m.loads?.external_load_number || null,
    planned_route_text: m.planned_route_text,
    planned_cities: toStringArray(m.planned_cities),
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
    remaining_cities: toStringArray(m.remaining_cities),
    arrival_forecast_text: m.arrival_forecast_text,
    arrival_forecast_at: m.arrival_forecast_at,
    status: m.status,
    last_update_at: m.last_update_at,
    notes: m.notes,
    revision: m.revision,
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
        .select('*, drivers:driver_route_monitors_driver_tenant_fk(name), vehicles:driver_route_monitors_vehicle_tenant_fk(plate), loads:driver_route_monitors_load_tenant_fk(load_number, external_load_number)')
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
    queryKey: ['driver-monitor-updates', currentTenant?.id, monitorId],
    enabled: !!monitorId && !!currentTenant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('driver_route_progress_updates')
        .select('*, drivers:driver_route_progress_updates_driver_tenant_fk(name)')
        .eq('monitor_id', monitorId!)
        .eq('tenant_id', currentTenant!.id)
        .order('update_date', { ascending: true });
      if (error) throw error;
      return (data || []).map(({ drivers, ...row }): ProgressUpdateRow => ({
        ...row,
        driver_name: drivers?.name ?? null,
      }));
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
        .select('*, drivers:driver_arrival_forecasts_driver_tenant_fk(name)')
        .eq('tenant_id', currentTenant!.id)
        .order('forecast_date', { ascending: false });
      if (monitorId) q = q.eq('monitor_id', monitorId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).map(({ drivers, ...row }): ForecastRow => ({
        ...row,
        driver_name: drivers?.name ?? null,
      }));
    },
  });
}

export function useDriverMonitorCommand() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const tenant = currentTenant?.id;
  const actor = user?.id;
  const latest = useRef({ tenant, actor });
  latest.current = { tenant, actor };
  const alive = useRef(true);
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    alive.current = true;
    const changed = () => setRevision(value => value + 1);
    window.addEventListener('storage', changed);
    window.addEventListener(DRIVER_MONITOR_COMMAND_CHANGED, changed);
    return () => {
      alive.current = false;
      window.removeEventListener('storage', changed);
      window.removeEventListener(DRIVER_MONITOR_COMMAND_CHANGED, changed);
    };
  }, []);

  const assertContext = useCallback(() => {
    if (!alive.current || latest.current.tenant !== tenant || latest.current.actor !== actor) {
      throw new Error('A sessão ou empresa mudou. Recupere o monitoramento na sessão original.');
    }
  }, [tenant, actor]);

  const outbox = useMemo(() => createDriverMonitorOutbox({
    get storage() { return window.localStorage; },
    uuid: () => crypto.randomUUID(),
    assertContext,
    changed: () => window.dispatchEvent(new Event(DRIVER_MONITOR_COMMAND_CHANGED)),
    lock: async (key, work) => {
      if (!navigator.locks) {
        throw new Error('Use um navegador atualizado em conexão segura para alterar o monitoramento.');
      }
      return navigator.locks.request(key, work);
    },
    send: async payload => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        return await supabase.rpc('apply_driver_monitor_command', {
          _payload: JSON.parse(JSON.stringify(payload)),
        }).abortSignal(controller.signal);
      } finally {
        clearTimeout(timeout);
      }
    },
  }), [assertContext]);

  const recovery = useMemo(() => {
    try {
      return {
        revision,
        pending: tenant && actor
          ? pendingDriverMonitorCommand(window.localStorage, tenant, actor)
          : null,
        error: null,
      };
    } catch (cause) {
      return { revision, pending: null, error: driverMonitorCommandError(cause) };
    }
  }, [tenant, actor, revision]);

  const run = async (work: () => Promise<DriverMonitorCommandResult>) => {
    if (!tenant || !actor) throw new Error('Entre com uma sessão válida e selecione a empresa.');
    if (busy.current) throw new Error('Aguarde o comando de monitoramento em andamento.');
    assertContext();
    busy.current = true;
    setPending(true);
    try {
      const result = await work();
      assertContext();
      return result;
    } catch (cause) {
      throw new Error(driverMonitorCommandError(cause));
    } finally {
      try {
        await Promise.all([
          'driver-monitors', 'driver-monitoring-history',
        ].map(key => qc.invalidateQueries({ queryKey: [key] })));
      } finally {
        busy.current = false;
        if (alive.current) setPending(false);
      }
    }
  };

  return {
    isPending,
    pending: recovery.pending,
    recoveryError: recovery.error,
    submit: (input: DriverMonitorCommandInput) => run(() => outbox.submit(tenant!, actor!, input)),
    recover: () => run(() => outbox.recover(tenant!, actor!)),
  };
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
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const tenantId = currentTenant.id;
      const { data: monitor, error: eM } = await supabase.from('driver_route_monitors')
        .select('*')
        .eq('id', payload.monitor_id)
        .eq('tenant_id', tenantId)
        .single();
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

      const { data: updates, error: updatesError } = await supabase.from('driver_route_progress_updates')
        .select('deliveries_completed_in_city, update_date, observation, status, created_at')
        .eq('monitor_id', payload.monitor_id)
        .eq('tenant_id', tenantId);
      if (updatesError) throw updatesError;
      const completed = calculateCompletedDeliveries(updates || []);
      const total = Number(monitor.total_deliveries || 0);
      const remaining = calculateRemainingDeliveries(total, completed);
      const newStatus = calculateDriverStatus(
        {
          ...monitor,
          completed_deliveries: completed,
          last_update_at: new Date().toISOString(),
          remaining_cities: toStringArray(monitor.remaining_cities),
        },
        updates || [],
      );
      const { error: monitorUpdateError } = await supabase.from('driver_route_monitors').update({
        completed_deliveries: completed,
        remaining_deliveries: remaining,
        current_city: payload.city || monitor.current_city,
        next_city: payload.next_city || monitor.next_city,
        last_update_at: new Date().toISOString(),
        status: newStatus,
      }).eq('id', payload.monitor_id).eq('tenant_id', tenantId);
      if (monitorUpdateError) throw monitorUpdateError;

      const { error: historyError } = await supabase.from('driver_monitoring_history').insert({
        tenant_id: tenantId, monitor_id: payload.monitor_id,
        action: 'progress_update', new_value: `${payload.city ?? ''} (+${payload.deliveries_completed_in_city ?? 0})`,
      });
      if (historyError) throw historyError;
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
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const tenantId = currentTenant.id;
      const { data: monitor, error: monitorError } = await supabase.from('driver_route_monitors')
        .select('driver_id')
        .eq('id', payload.monitor_id)
        .eq('tenant_id', tenantId)
        .single();
      if (monitorError) throw monitorError;
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
      const { error: monitorUpdateError } = await supabase.from('driver_route_monitors').update({
        arrival_forecast_text: payload.forecast_text || null,
        current_city: payload.current_city || undefined,
      }).eq('id', payload.monitor_id).eq('tenant_id', tenantId);
      if (monitorUpdateError) throw monitorUpdateError;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-monitors'] });
      qc.invalidateQueries({ queryKey: ['driver-arrival-forecasts'] });
    },
  });
}

export function useMonitorHistory(monitorId?: string | null) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-monitoring-history', currentTenant?.id, monitorId],
    enabled: !!monitorId && !!currentTenant,
    queryFn: async () => {
      const { data, error } = await supabase.from('driver_monitoring_history')
        .select('*')
        .eq('monitor_id', monitorId!)
        .eq('tenant_id', currentTenant!.id)
        .order('created_at', { ascending: false });
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
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const tenantId = currentTenant.id;
      // Find existing drivers by name (case-insensitive).
      const { data: driversData } = await supabase.from('drivers')
        .select('id, name').eq('tenant_id', tenantId);
      const findDriver = (n: string | null) => {
        if (!n) return null;
        const norm = n.trim().toLowerCase();
        return (driversData || []).find((driver) => (driver.name || '').toLowerCase() === norm) || null;
      };

      const { data: batch, error: eB } = await supabase.from('driver_monitoring_import_batches').insert({
        tenant_id: tenantId,
        file_name: file.name,
        row_count: parsed.monitors.length + parsed.forecasts.length,
        status: 'processing',
        errors: parsed.errors,
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
          planned_cities: m.planned_cities,
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
          const { error: monitorUpdateError } = await supabase.from('driver_route_monitors').update({
            completed_deliveries: completed,
            remaining_deliveries: remaining,
            current_city: last?.city || null,
            next_city: last?.next_city || null,
            last_update_at: new Date().toISOString(),
          }).eq('id', mon.id).eq('tenant_id', tenantId);
          if (monitorUpdateError) errors.push(`Erro ao consolidar ${m.driver_name}: ${monitorUpdateError.message}`);
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
          remaining_cities: f.remaining_cities,
          observation: f.observation,
          status: 'active',
        });
        if (eF) errors.push(`Erro previsão ${f.driver_name}: ${eF.message}`);
        else importedForecasts++;
      }

      const { error: batchUpdateError } = await supabase.from('driver_monitoring_import_batches').update({
        imported_monitors: importedMonitors,
        imported_updates: importedUpdates,
        imported_forecasts: importedForecasts,
        error_count: errors.length,
        status: errors.length ? 'completed_with_errors' : 'completed',
        errors,
      }).eq('id', batch.id).eq('tenant_id', tenantId);
      if (batchUpdateError) throw batchUpdateError;

      return { importedMonitors, importedUpdates, importedForecasts, errors };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-monitors'] });
      qc.invalidateQueries({ queryKey: ['driver-arrival-forecasts'] });
    },
  });
}
