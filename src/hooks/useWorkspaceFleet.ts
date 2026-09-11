import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { Json } from '@/integrations/supabase/types';
import type { MovementState } from './useVehiclesState';

export interface WorkspaceFleetSnapshot {
  id: string;
  tenant_id: string;
  source_tenant_id: string | null;
  source_vehicle_id: string | null;
  plate: string;
  nickname: string | null;
  type: string | null;
  uf: string | null;
  active: boolean;
  tags: Json;
  created_at: string;
  max_pallets: number | null;
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  body_type: string | null;
  current_driver_id: string | null;
  renavam: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  heading: number | null;
  captured_at: string | null;
  received_at: string | null;
  movement_state: MovementState | null;
  last_movement_at: string | null;
  stopped_since: string | null;
  stopped_duration_seconds: number;
  state_updated_at: string | null;
}

export function useWorkspaceFleetSnapshot() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['workspace_fleet_snapshot', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_workspace_fleet_snapshot_v1', {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return (data || []) as WorkspaceFleetSnapshot[];
    },
    enabled: !!currentTenant,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
