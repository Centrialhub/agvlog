import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export type MovementState = 'moving' | 'stopped' | 'idle' | 'offline' | 'unknown';

export interface VehicleState {
  vehicle_id: string;
  tenant_id: string;
  lat: number | null;
  lng: number | null;
  speed: number;
  heading: number | null;
  movement_state: MovementState;
  last_movement_at: string | null;
  last_position_at: string | null;
  stopped_since: string | null;
  stopped_duration_seconds: number;
  updated_at: string;
}

export function useFleetState() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['vehicles_state', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('vehicles_state')
        .select('*')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return (data || []) as VehicleState[];
    },
    enabled: !!currentTenant,
    refetchInterval: 30000,
  });
}

export function useVehicleState(vehicleId: string | null) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['vehicle_state', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return null;
      const { data, error } = await supabase
        .from('vehicles_state')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('vehicle_id', vehicleId)
        .maybeSingle();
      if (error) throw error;
      return data as VehicleState | null;
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
