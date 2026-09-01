import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import {
  resolvePositionTelemetry,
  type TelemetryMovementState,
} from '@/lib/positionTelemetry';
import { fetchFleetPositionPages } from './usePositions';

export type MovementState = TelemetryMovementState;

export interface VehicleState {
  vehicle_id: string;
  tenant_id: string;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  movement_state: MovementState;
  last_movement_at: string | null;
  last_position_at: string | null;
  stopped_since: string | null;
  stopped_duration_seconds: number;
  updated_at: string;
}

const VEHICLE_STATE_SAFE_SELECT =
  'vehicle_id, tenant_id, lat, lng, speed, heading, movement_state, last_movement_at, last_position_at, stopped_since, stopped_duration_seconds, updated_at';
const POSITION_LAST_SAFE_SELECT =
  'vehicle_id, captured_at, lat, lng, speed, heading';
const TELEMETRY_PAGE_SIZE = 500;
const MAX_FLEET_STATES = 5_000;

async function fetchFleetStatePages(tenantId: string, signal: AbortSignal): Promise<VehicleState[]> {
  const rows: VehicleState[] = [];
  let afterVehicleId: string | null = null;

  for (let pageIndex = 0; pageIndex <= MAX_FLEET_STATES / TELEMETRY_PAGE_SIZE; pageIndex += 1) {
    const isOverflowProbe = pageIndex === MAX_FLEET_STATES / TELEMETRY_PAGE_SIZE;
    const pageSize = isOverflowProbe ? 1 : TELEMETRY_PAGE_SIZE;
    let query = supabase
      .from('vehicles_state')
      .select(VEHICLE_STATE_SAFE_SELECT)
      .eq('tenant_id', tenantId)
      .order('vehicle_id', { ascending: true })
      .limit(pageSize);
    if (afterVehicleId) query = query.gt('vehicle_id', afterVehicleId);
    const { data, error } = await query
      .abortSignal(signal);

    if (error) throw error;
    const page = (data || []) as VehicleState[];
    if (isOverflowProbe) {
      if (page.length > 0) {
        throw new Error('A frota excede o limite seguro de 5.000 estados de telemetria.');
      }
      return rows;
    }

    rows.push(...page);
    if (page.length < pageSize) return rows;
    const lastVehicleId = page.at(-1)?.vehicle_id;
    if (!lastVehicleId || lastVehicleId === afterVehicleId) {
      throw new Error('O cursor de estados da frota não avançou.');
    }
    afterVehicleId = lastVehicleId;
  }

  return rows;
}

export function useFleetState() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['vehicles_state', currentTenant?.id],
    queryFn: async ({ signal }) => {
      if (!currentTenant) return [];
      const [statesResult, positionsResult] = await Promise.all([
        fetchFleetStatePages(currentTenant.id, signal),
        fetchFleetPositionPages(currentTenant.id, signal),
      ]);
      const positionByVehicle = new Map(
        positionsResult.map((position) => [position.vehicle_id, position]),
      );
      return statesResult.map((state) => {
        const position = positionByVehicle.get(state.vehicle_id);
        const telemetry = resolvePositionTelemetry(position, state);
        const isStopped = telemetry.movementState === 'stopped' || telemetry.movementState === 'idle';
        return {
          ...state,
          lat: position?.lat ?? null,
          lng: position?.lng ?? null,
          heading: position?.heading ?? null,
          speed: telemetry.speed,
          movement_state: telemetry.movementState,
          last_position_at: telemetry.capturedAt,
          stopped_since: isStopped ? state.stopped_since : null,
          stopped_duration_seconds: isStopped ? state.stopped_duration_seconds : 0,
        };
      });
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
}

export function useVehicleState(vehicleId: string | null) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['vehicle_state', currentTenant?.id, vehicleId],
    queryFn: async ({ signal }) => {
      if (!currentTenant || !vehicleId) return null;
      const [stateResult, positionResult] = await Promise.all([
        supabase.from('vehicles_state')
          .select(VEHICLE_STATE_SAFE_SELECT)
          .eq('tenant_id', currentTenant.id)
          .eq('vehicle_id', vehicleId)
          .abortSignal(signal)
          .maybeSingle(),
        supabase.from('positions_last')
          .select(POSITION_LAST_SAFE_SELECT)
          .eq('tenant_id', currentTenant.id)
          .eq('vehicle_id', vehicleId)
          .abortSignal(signal)
          .maybeSingle(),
      ]);
      if (stateResult.error) throw stateResult.error;
      if (positionResult.error) throw positionResult.error;
      if (!stateResult.data) return null;
      const state = stateResult.data as VehicleState;
      const position = positionResult.data;
      const telemetry = resolvePositionTelemetry(position, state);
      const isStopped = telemetry.movementState === 'stopped' || telemetry.movementState === 'idle';
      return {
        ...state,
        lat: position?.lat ?? null,
        lng: position?.lng ?? null,
        heading: position?.heading ?? null,
        speed: telemetry.speed,
        movement_state: telemetry.movementState,
        last_position_at: telemetry.capturedAt,
        stopped_since: isStopped ? state.stopped_since : null,
        stopped_duration_seconds: isStopped ? state.stopped_duration_seconds : 0,
      };
    },
    enabled: !!currentTenant && !!vehicleId,
    refetchInterval: 30000,
  });
}

export function stateLabel(state: MovementState): string {
  switch (state) {
    case 'moving': return 'Movendo';
    case 'stopped': return 'Parado';
    case 'idle': return 'Ocioso';
    case 'offline': return 'Offline';
    case 'unknown': return 'Sem dados';
  }
}

export function stateColor(state: MovementState): string {
  switch (state) {
    case 'moving': return '#22c55e';
    case 'stopped': return '#f59e0b';
    case 'idle': return '#3b82f6';
    case 'offline': return '#94a3b8';
    case 'unknown': return '#cbd5e1';
  }
}

export function stateBadgeClasses(state: MovementState): string {
  switch (state) {
    case 'moving': return 'bg-success/10 text-success border-success/30';
    case 'stopped': return 'bg-warning/10 text-warning border-warning/30';
    case 'idle': return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
    case 'offline': return 'bg-muted text-muted-foreground';
    case 'unknown': return 'bg-muted/50 text-muted-foreground/50';
  }
}

export function stateDotClass(state: MovementState): string {
  switch (state) {
    case 'moving': return 'bg-success';
    case 'stopped': return 'bg-warning';
    case 'idle': return 'bg-blue-500';
    case 'offline': return 'bg-muted-foreground';
    case 'unknown': return 'bg-muted-foreground/30';
  }
}

export function formatStoppedDuration(seconds: number): string {
  if (seconds < 60) return 'agora';
  const min = Math.floor(seconds / 60);
  const hours = Math.floor(min / 60);
  const days = Math.floor(hours / 24);
  if (min < 60) return `${min} min`;
  if (hours < 24) return `${hours}h ${min % 60}m`;
  return `${days}d ${hours % 24}h`;
}
