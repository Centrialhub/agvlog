import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import { calculateDriverStatus, calculateProgressPercent, calculateRemainingDeliveries, type DriverMonitorStatus } from '@/lib/driverMonitoring/driverMonitoringCalculator';
import type {
  ParsedDriverMonitoringWorkbook,
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
type ProgressUpdateQueryRow = Database['public']['Tables']['driver_route_progress_updates']['Row'] & { drivers:{name:string}|null };
type ForecastQueryRow = Database['public']['Tables']['driver_arrival_forecasts']['Row'] & { drivers:{name:string}|null };

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

function toRow(m: DriverMonitorQueryRow,timeZone:string): DriverMonitorRow {
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
    status: calculateDriverStatus({
      total_deliveries: total,
      completed_deliveries: completed,
      expected_return_date: m.expected_return_date,
      actual_returned_at: m.actual_returned_at,
      status: m.status,
      last_update_at: m.last_update_at,
      remaining_cities: toStringArray(m.remaining_cities),
      current_city: m.current_city,
      notes: m.notes,
    }, [], new Date(), timeZone),
    last_update_at: m.last_update_at,
    notes: m.notes,
    revision: m.revision,
    updated_at: m.updated_at,
  };
}

export const DRIVER_MONITOR_PAGE_SIZE=50;
export function matchesDriverMonitorStatusFilters(row:DriverMonitorRow,filters:DriverMonitoringFilters){
  if(filters.status&&row.status!==filters.status)return false;
  if(filters.onlyDelayed&&row.status!=='delayed')return false;
  if(filters.onlyNoUpdate&&row.status!=='no_update')return false;
  return true;
}
export function useDriverMonitorsList(filters: DriverMonitoringFilters = {},page=1) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-monitors', currentTenant?.id, filters,page],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      const hasDerivedStatusFilter=!!filters.status||!!filters.onlyDelayed||!!filters.onlyNoUpdate;
      if(hasDerivedStatusFilter){
        const all=await fetchAllPostgrestPages<DriverMonitorQueryRow>(async(from,to)=>{
          let query=supabase.from('driver_route_monitors')
            .select('*, drivers:driver_route_monitors_driver_tenant_fk(name), vehicles:driver_route_monitors_vehicle_tenant_fk(plate), loads:driver_route_monitors_load_tenant_fk(load_number, external_load_number)')
            .eq('tenant_id',currentTenant!.id);
          if(filters.driverId)query=query.eq('driver_id',filters.driverId);if(filters.vehicleId)query=query.eq('vehicle_id',filters.vehicleId);
          if(filters.loadId)query=query.eq('load_id',filters.loadId);if(filters.currentCity)query=query.ilike('current_city',`%${filters.currentCity}%`);
          if(filters.nextCity)query=query.ilike('next_city',`%${filters.nextCity}%`);if(filters.plate)query=query.ilike('vehicle_plate_snapshot',`%${filters.plate}%`);
          if(filters.startedFrom)query=query.gte('started_at',filters.startedFrom);if(filters.startedTo)query=query.lte('started_at',filters.startedTo);
          const {data,error}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to);
          return {data:(data??[]) as DriverMonitorQueryRow[],error};
        },500);
        const matched=all.map(row=>toRow(row,currentTenant!.timezone)).filter(row=>matchesDriverMonitorStatusFilters(row,filters));
        const start=(page-1)*DRIVER_MONITOR_PAGE_SIZE;
        return {rows:matched.slice(start,start+DRIVER_MONITOR_PAGE_SIZE),total:matched.length};
      }
      let q = supabase.from('driver_route_monitors')
          .select('*, drivers:driver_route_monitors_driver_tenant_fk(name), vehicles:driver_route_monitors_vehicle_tenant_fk(plate), loads:driver_route_monitors_load_tenant_fk(load_number, external_load_number)',{count:'exact'})
          .eq('tenant_id', currentTenant!.id);
        if (filters.driverId) q = q.eq('driver_id', filters.driverId);
        if (filters.vehicleId) q = q.eq('vehicle_id', filters.vehicleId);
        if (filters.loadId) q = q.eq('load_id', filters.loadId);
        if (filters.currentCity) q = q.ilike('current_city', `%${filters.currentCity}%`);
        if (filters.nextCity) q = q.ilike('next_city', `%${filters.nextCity}%`);
        if (filters.plate) q = q.ilike('vehicle_plate_snapshot', `%${filters.plate}%`);
        if (filters.startedFrom) q = q.gte('started_at', filters.startedFrom);
        if (filters.startedTo) q = q.lte('started_at', filters.startedTo);
      const from=(page-1)*DRIVER_MONITOR_PAGE_SIZE;
      const {data,error,count}=await q.order('created_at',{ascending:false}).order('id',{ascending:false})
        .range(from,from+DRIVER_MONITOR_PAGE_SIZE-1);
      if(error)throw error;
      return {rows:((data??[]) as DriverMonitorQueryRow[]).map(row=>toRow(row,currentTenant!.timezone)),total:count??0};
    },
  });
}

export function useDriverMonitorsReport(filters: DriverMonitoringFilters = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-monitors-report', currentTenant?.id, filters],
    enabled: !!currentTenant?.id,
    queryFn: async () => {
      const data=await fetchAllPostgrestPages<DriverMonitorQueryRow>(async(from,to)=>{
        let q=supabase.from('driver_route_monitors')
          .select('*, drivers:driver_route_monitors_driver_tenant_fk(name), vehicles:driver_route_monitors_vehicle_tenant_fk(plate), loads:driver_route_monitors_load_tenant_fk(load_number, external_load_number)')
          .eq('tenant_id',currentTenant!.id);
        if(filters.driverId)q=q.eq('driver_id',filters.driverId);if(filters.vehicleId)q=q.eq('vehicle_id',filters.vehicleId);
        if(filters.loadId)q=q.eq('load_id',filters.loadId);if(filters.currentCity)q=q.ilike('current_city',`%${filters.currentCity}%`);
        if(filters.nextCity)q=q.ilike('next_city',`%${filters.nextCity}%`);if(filters.plate)q=q.ilike('vehicle_plate_snapshot',`%${filters.plate}%`);
        if(filters.startedFrom)q=q.gte('started_at',filters.startedFrom);if(filters.startedTo)q=q.lte('started_at',filters.startedTo);
        const {data,error}=await q.order('created_at',{ascending:false}).order('id',{ascending:false}).range(from,to);
        return {data:(data??[]) as DriverMonitorQueryRow[],error};
      },500);
      return data.map(row=>toRow(row,currentTenant!.timezone)).filter(row=>matchesDriverMonitorStatusFilters(row,filters));
    },
  });
}

export function useMonitorUpdates(monitorId: string | null | undefined) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-monitor-updates', currentTenant?.id, monitorId],
    enabled: !!monitorId && !!currentTenant?.id,
    queryFn: async () => {
      const data=await fetchAllPostgrestPages<ProgressUpdateQueryRow>(async(from,to)=>{
        const {data,error}=await supabase.from('driver_route_progress_updates')
          .select('*, drivers:driver_route_progress_updates_driver_tenant_fk(name)')
          .eq('monitor_id', monitorId!).eq('tenant_id', currentTenant!.id)
          .order('update_date', { ascending: false }).order('id', { ascending: false }).range(from,to);
        return {data:(data??[]) as ProgressUpdateQueryRow[],error};
      },500);
      return data.map(({ drivers, ...row }): ProgressUpdateRow => ({
        ...row,
        driver_name: drivers?.name ?? null,
      }));
    },
  });
}

export function useMonitorForecasts(monitorIds: string[] = []) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['driver-arrival-forecasts', monitorIds, currentTenant?.id],
    enabled: !!currentTenant?.id&&monitorIds.length>0,
    queryFn: async () => {
      const uniqueIds=[...new Set(monitorIds)],all:ForecastQueryRow[]=[];
      for(let start=0;start<uniqueIds.length;start+=100){
        const ids=uniqueIds.slice(start,start+100);
        all.push(...await fetchAllPostgrestPages<ForecastQueryRow>(async(from,to)=>{
          const {data,error}=await supabase.from('driver_arrival_forecasts')
            .select('*, drivers:driver_arrival_forecasts_driver_tenant_fk(name)')
            .eq('tenant_id', currentTenant!.id).in('monitor_id',ids)
            .order('forecast_date',{ascending:false}).order('id',{ascending:false}).range(from,to);
          return {data:(data??[]) as ForecastQueryRow[],error};
        },500));
      }
      return all.map(({ drivers, ...row }): ForecastRow => ({
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
  const busy = useRef(false);
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
      if (busy.current) throw new Error('A atualização já está sendo salva.');
      busy.current = true;
      try {
        const { error } = await supabase.rpc('add_driver_progress_v1', {
          _payload: {
            ...payload,
            tenant_id: currentTenant.id,
            request_id: crypto.randomUUID(),
          } as unknown as Json,
        });
        if (error) throw error;
      } finally {
        busy.current = false;
      }
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
  const busy = useRef(false);
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
      if (busy.current) throw new Error('A previsão já está sendo salva.');
      busy.current = true;
      try {
        const { error } = await supabase.rpc('add_driver_forecast_v1', {
          _payload: {
            ...payload,
            tenant_id: currentTenant.id,
            request_id: crypto.randomUUID(),
          } as unknown as Json,
        });
        if (error) throw error;
      } finally {
        busy.current = false;
      }
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
      const normalizeName = (value: string | null) => (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
      const keysByDriver = new Map<string, string[]>();
      const monitors = parsed.monitors.map((monitor, index) => {
        const client_key = `monitor-${index + 1}`;
        const normalized = normalizeName(monitor.driver_name);
        keysByDriver.set(normalized, [...(keysByDriver.get(normalized) || []), client_key]);
        return { ...monitor, client_key };
      });
      const forecasts = parsed.forecasts.map((forecast) => {
        const keys = keysByDriver.get(normalizeName(forecast.driver_name)) || [];
        if (keys.length > 1) {
          throw new Error(`Previsão ambígua para ${forecast.driver_name}: há mais de um bloco de entregas para o motorista.`);
        }
        return { ...forecast, monitor_key: keys.length === 1 ? keys[0] : null };
      });
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const fileFingerprint = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const { data, error } = await supabase.rpc('import_driver_monitoring_workbook_v1', {
        _payload: {
          tenant_id: tenantId,
          request_id: crypto.randomUUID(),
          file_name: file.name,
          file_fingerprint: fileFingerprint,
          parsed: { ...parsed, monitors, forecasts },
        } as unknown as Json,
      });
      if (error) throw error;
      return data as unknown as {
        importedMonitors: number;
        importedUpdates: number;
        importedForecasts: number;
        errors: string[];
        duplicate: boolean;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver-monitors'] });
      qc.invalidateQueries({ queryKey: ['driver-arrival-forecasts'] });
    },
  });
}
