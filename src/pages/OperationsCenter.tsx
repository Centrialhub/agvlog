import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { resolvePositionTelemetry } from '@/lib/positionTelemetry';
import { useTenant } from '@/hooks/useTenant';
import { useFleetPositions } from '@/hooks/usePositions';
import { fiscalDocRevenue, isVoidFiscalStatus } from '@/lib/fiscal/documentStatus';
import { useFleetState } from '@/hooks/useVehiclesState';
import { useVehicles } from '@/hooks/useVehicles';
import { useDrivers } from '@/hooks/useDrivers';
import { OperationsCenterHeader } from '@/components/operations/OperationsCenterHeader';
import { OperationsCenterKpis } from '@/components/operations/OperationsCenterKpis';
import { OperationsCenterMonitoring } from '@/components/operations/OperationsCenterMonitoring';
import { OperationsCenterAnalytics } from '@/components/operations/OperationsCenterAnalytics';
import { OperationsCenterActivity } from '@/components/operations/OperationsCenterActivity';
import { LOAD_STATUS_LABELS } from '@/components/operations/operationsCenterPresentation';
import type { OperationsCenterViewModel } from '@/components/operations/operationsCenterTypes';

function requireExactCount(count: number | null, label: string): number {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    throw new Error(`A contagem exata de ${label} não foi confirmada.`);
  }
  return count;
}

export default function OperationsCenter() {
  const { currentTenant, loading: tenantLoading } = useTenant();
  const navigate = useNavigate();
  const loadsQuery = useQuery({
    queryKey: ['ops_loads', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const [rowsResult, countsResult] = await Promise.all([
        supabase
          .from('loads')
          .select('*, vehicles(plate, nickname), drivers(name)')
          .eq('tenant_id', currentTenant.id)
          .order('updated_at', { ascending: false })
          .limit(200),
        supabase.rpc('get_operations_load_counts_v1', { _tenant_id: currentTenant.id }),
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (countsResult.error) throw countsResult.error;
      const counts = countsResult.data?.[0];
      return {
        rows: rowsResult.data || [],
        activeCount: requireExactCount(counts?.active_count ?? null, 'cargas ativas'),
        inTransitCount: requireExactCount(counts?.in_transit_count ?? null, 'cargas em trânsito'),
        delayedCount: requireExactCount(counts?.delayed_count ?? null, 'cargas atrasadas'),
      };
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const loads = useMemo(
    () => loadsQuery.isError ? [] : loadsQuery.data?.rows ?? [],
    [loadsQuery.data, loadsQuery.isError],
  );

  // ── Fiscal Documents ──
  const fiscalQuery = useQuery({
    queryKey: ['ops_fiscal', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('id, document_type, value, weight_kg, pallet_count, status, created_at, issue_date, freight_value')
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const fiscalDocs = useMemo(
    () => fiscalQuery.isError ? [] : fiscalQuery.data ?? [],
    [fiscalQuery.data, fiscalQuery.isError],
  );

  // ── Alert Instances ──
  const alertsQuery = useQuery({
    queryKey: ['ops_alerts', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const { data, error, count } = await supabase
        .from('alert_instances')
        .select('*, alert_rules(rule_type, params), vehicles(plate, nickname)', { count: 'exact' })
        .eq('tenant_id', currentTenant.id)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return { rows: data || [], total: requireExactCount(count, 'alertas ativos') };
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const alerts = useMemo(
    () => alertsQuery.isError ? [] : alertsQuery.data?.rows ?? [],
    [alertsQuery.data, alertsQuery.isError],
  );

  // ── Incidents ──
  const incidentsQuery = useQuery({
    queryKey: ['ops_incidents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const [rowsResult, criticalResult] = await Promise.all([
        supabase
          .from('incidents')
          .select('id, status, severity, title, incident_type, created_at, occurred_at', { count: 'exact' })
          .eq('tenant_id', currentTenant.id)
          .not('status', 'in', '("closed","resolved","cancelled")')
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('incidents')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', currentTenant.id)
          .not('status', 'in', '("closed","resolved","cancelled")')
          .in('severity', ['critical', 'high']),
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (criticalResult.error) throw criticalResult.error;
      return {
        rows: rowsResult.data || [],
        openCount: requireExactCount(rowsResult.count, 'incidentes abertos'),
        criticalCount: requireExactCount(criticalResult.count, 'incidentes críticos'),
      };
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const incidents = useMemo(
    () => incidentsQuery.isError ? [] : incidentsQuery.data?.rows ?? [],
    [incidentsQuery.data, incidentsQuery.isError],
  );

  // ── Fleet ──
  const vehiclesQuery = useVehicles();
  const vehicleStatesQuery = useFleetState();
  const positionsQuery = useFleetPositions();
  const vehicles = useMemo(
    () => vehiclesQuery.isError ? [] : vehiclesQuery.data ?? [],
    [vehiclesQuery.data, vehiclesQuery.isError],
  );
  const vehicleStates = useMemo(
    () => vehicleStatesQuery.isError ? [] : vehicleStatesQuery.data ?? [],
    [vehicleStatesQuery.data, vehicleStatesQuery.isError],
  );
  const positions = useMemo(
    () => positionsQuery.isError ? [] : positionsQuery.data ?? [],
    [positionsQuery.data, positionsQuery.isError],
  );

  // ── Drivers ──
  const driversQuery = useDrivers({ includeInactive: true });
  const drivers = useMemo(
    () => driversQuery.isError ? [] : driversQuery.data ?? [],
    [driversQuery.data, driversQuery.isError],
  );

  // ── Pending expenses ──
  const expensesQuery = useQuery({
    queryKey: ['ops_expenses_count', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const { count, error } = await supabase
        .from('driver_expenses')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .eq('approval_status', 'pending');
      if (error) throw error;
      return requireExactCount(count, 'despesas pendentes');
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const pendingExpenses = expensesQuery.isError ? null : expensesQuery.data ?? null;

  // ── Maintenance ──
  const maintenanceQuery = useQuery({
    queryKey: ['ops_maintenance', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const { count, error } = await supabase
        .from('maintenance_orders')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', currentTenant.id)
        .not('status', 'in', '("closed","completed")');
      if (error) throw error;
      return requireExactCount(count, 'ordens de manutenção abertas');
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const openMaintenance = maintenanceQuery.isError ? null : maintenanceQuery.data ?? null;

  // ── Dispatch Trips ──
  const tripsQuery = useQuery({
    queryKey: ['ops_trips', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) throw new Error('Empresa operacional não selecionada.');
      const { data, error, count } = await supabase
        .from('dispatch_trips')
        .select('id, status, vehicle_id, driver_id, load_id, planned_start_at, actual_start_at', { count: 'exact' })
        .eq('tenant_id', currentTenant.id)
        .in('status', ['planned', 'in_progress'])
        .limit(50);
      if (error) throw error;
      return { rows: data || [], total: requireExactCount(count, 'viagens ativas') };
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
  const tenantUnavailable = !tenantLoading && !currentTenant;
  const loadsPending = tenantLoading || (!!currentTenant && loadsQuery.isPending);
  const loadsUnavailable = tenantUnavailable || loadsQuery.isError;
  const fiscalPending = tenantLoading || (!!currentTenant && fiscalQuery.isPending);
  const fiscalUnavailable = tenantUnavailable || fiscalQuery.isError;
  const alertsPending = tenantLoading || (!!currentTenant && alertsQuery.isPending);
  const alertsUnavailable = tenantUnavailable || alertsQuery.isError;
  const incidentsPending = tenantLoading || (!!currentTenant && incidentsQuery.isPending);
  const incidentsUnavailable = tenantUnavailable || incidentsQuery.isError;
  const driversPending = tenantLoading || (!!currentTenant && driversQuery.isPending);
  const driversUnavailable = tenantUnavailable || driversQuery.isError;
  const expensesPending = tenantLoading || (!!currentTenant && expensesQuery.isPending);
  const expensesUnavailable = tenantUnavailable || expensesQuery.isError;
  const maintenancePending = tenantLoading || (!!currentTenant && maintenanceQuery.isPending);
  const maintenanceUnavailable = tenantUnavailable || maintenanceQuery.isError;
  const tripsPending = tenantLoading || (!!currentTenant && tripsQuery.isPending);
  const tripsUnavailable = tenantUnavailable || tripsQuery.isError;
  const fleetPending = tenantLoading || (!!currentTenant && (
    vehiclesQuery.isPending || vehicleStatesQuery.isPending || positionsQuery.isPending
  ));
  const fleetUnavailable = tenantUnavailable
    || vehiclesQuery.isError
    || vehicleStatesQuery.isError
    || positionsQuery.isError;

  // ── Fleet Map Data ──
  const stateMap = useMemo(() => {
    const map: Record<string, (typeof vehicleStates)[number]> = {};
    for (const s of vehicleStates) map[s.vehicle_id] = s;
    return map;
  }, [vehicleStates]);
  const positionMap = useMemo(
    () => new Map(positions.map((position) => [position.vehicle_id, position])),
    [positions],
  );

  const enrichedVehicles = useMemo(() => {
    return vehicles.map(v => {
      const state = stateMap[v.id];
      const pos = positionMap.get(v.id);
      const telemetry = resolvePositionTelemetry(pos, state);
      return {
        vehicle: v,
        state: telemetry.movementState,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        speed: telemetry.speed,
        stoppedDuration: telemetry.movementState === 'stopped' || telemetry.movementState === 'idle'
          ? state?.stopped_duration_seconds ?? 0
          : 0,
        lastPositionAt: telemetry.capturedAt,
      };
    });
  }, [vehicles, stateMap, positionMap]);

  const vehiclesWithPosition = useMemo(() =>
    enrichedVehicles.filter(e => e.lat != null && e.lng != null),
    [enrichedVehicles]
  );
  const mapPoints = useMemo<[number, number][]>(
    () => vehiclesWithPosition.map((entry) => [entry.lat as number, entry.lng as number]),
    [vehiclesWithPosition],
  );

  const fleetStats = useMemo(() => {
    const moving = enrichedVehicles.filter(e => e.state === 'moving').length;
    const stopped = enrichedVehicles.filter(e => e.state === 'stopped').length;
    const idle = enrichedVehicles.filter(e => e.state === 'idle').length;
    const offline = enrichedVehicles.filter(e => e.state === 'offline').length;
    const unknown = enrichedVehicles.filter(e => e.state === 'unknown').length;
    return { total: vehicles.length, moving, stopped, idle, offline, unknown, online: moving + stopped + idle };
  }, [vehicles, enrichedVehicles]);

  // ── Computed Stats ──
  const stats = useMemo(() => {
    const activeLoadSample = loads.filter((load) => !['delivered', 'cancelled'].includes(load.status));
    const totalWeightActive = activeLoadSample.reduce((sum, load) => sum + (Number(load.total_weight_kg) || 0), 0);
    const totalPalletsActive = activeLoadSample.reduce((sum, load) => sum + (Number(load.total_pallet_count) || 0), 0);

    // Documentos válidos seguindo lógica fiscal centralizada
    const nfes = fiscalDocs.filter((document) => document.document_type === 'inbound' && !isVoidFiscalStatus(document.status));
    const ctes = fiscalDocs.filter((document) => document.document_type === 'outbound' && !isVoidFiscalStatus(document.status));
    
    const totalNfeValue = nfes.reduce((sum, document) => sum + (Number(document.value) || 0), 0);
    // Receita de CT-e (confirmados): rascunhos/transmitindo não somam em faturamento real no dashboard
    const totalFreight = ctes.filter(d => !['draft', 'pending', 'processing', 'submitted'].includes(d.status))
      .reduce((sum, document) => sum + fiscalDocRevenue(document), 0);
    const totalCteValue = totalFreight;

    const activeDrivers = drivers.filter((driver) => driver.active);
    const driversWithVehicle = drivers.filter((driver) => driver.active && driver.current_vehicle_id);
    return {
      activeLoads: loadsQuery.data?.activeCount ?? 0,
      inTransit: loadsQuery.data?.inTransitCount ?? 0,
      delayed: loadsQuery.data?.delayedCount ?? 0,
      totalWeightActive,
      totalPalletsActive,
      nfeCount: nfes.length,
      cteCount: ctes.length,
      totalNfeValue,
      totalCteValue,
      totalFreight,
      activeDrivers: activeDrivers.length,
      driversWithVehicle: driversWithVehicle.length,
      openIncidents: incidentsQuery.data?.openCount ?? 0,
      criticalIncidents: incidentsQuery.data?.criticalCount ?? 0,
      activeTrips: tripsQuery.data?.total ?? 0,
    };
  }, [loads, loadsQuery.data, fiscalDocs, drivers, incidentsQuery.data, tripsQuery.data]);

  // ── Chart Data ──
  const destChart = useMemo(() => {
    const activeLoads = loads.filter((load) => !['delivered', 'cancelled'].includes(load.status));
    const groups: Record<string, { pallets: number; weight: number; count: number }> = {};
    activeLoads.forEach((load) => {
      const dest = (load.destination || 'Sem destino').substring(0, 20);
      if (!groups[dest]) groups[dest] = { pallets: 0, weight: 0, count: 0 };
      groups[dest].pallets += Number(load.total_pallet_count) || 0;
      groups[dest].weight += Number(load.total_weight_kg) || 0;
      groups[dest].count += 1;
    });
    return Object.entries(groups)
      .map(([dest, v]) => ({ dest, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [loads]);

  const statusChart = useMemo(() => {
    const counts: Record<string, number> = {};
    loads.forEach((load) => {
      const s = load.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: LOAD_STATUS_LABELS[status] || status,
      value,
    }));
  }, [loads]);

  const nfeByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const nfes = fiscalDocs.filter((document) => document.document_type === 'inbound');
    nfes.forEach((document) => {
      const day = (document.issue_date || document.created_at?.slice(0, 10)) || '';
      if (day) days[day] = (days[day] || 0) + 1;
    });
    return Object.entries(days)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, qty]) => ({ day: format(new Date(day + 'T12:00:00'), 'dd/MM'), qty }))
      .slice(-14);
  }, [fiscalDocs]);

  const hasDelayedLoads = !loadsPending && !loadsUnavailable && stats.delayed > 0;
  const hasOpenIncidents = !incidentsPending && !incidentsUnavailable && stats.openIncidents > 0;
  const alertTotal = alertsQuery.data?.total ?? 0;

  const viewModel: OperationsCenterViewModel = {
    loads,
    alerts,
    incidents,
    vehiclesWithPosition,
    mapPoints,
    fleetStats,
    stats,
    destChart,
    statusChart,
    nfeByDay,
    pendingExpenses,
    openMaintenance,
    alertTotal,
    loadsPending,
    loadsUnavailable,
    fiscalPending,
    fiscalUnavailable,
    alertsPending,
    alertsUnavailable,
    incidentsPending,
    incidentsUnavailable,
    driversPending,
    driversUnavailable,
    expensesPending,
    expensesUnavailable,
    maintenancePending,
    maintenanceUnavailable,
    tripsPending,
    tripsUnavailable,
    fleetPending,
    fleetUnavailable,
    hasDelayedLoads,
    hasOpenIncidents,
  };

  return (
    <div className="animate-fade-in space-y-5">
      <OperationsCenterHeader onNavigate={navigate} />
      <OperationsCenterKpis model={viewModel} onNavigate={navigate} />

      <OperationsCenterMonitoring model={viewModel} onNavigate={navigate} />

      <OperationsCenterAnalytics model={viewModel} />

      <OperationsCenterActivity model={viewModel} onNavigate={navigate} />
    </div>
  );
}
