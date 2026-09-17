import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import {acknowledgeDurableOperatorCommand,prepareDurableOperatorCommand} from '@/lib/operator/durableOperatorCommand';
import {fetchAllPostgrestPages} from '@/lib/supabase/fetchAllPages';

/* ─── Types ─── */
export type VehicleMaintenance = Tables<'vehicle_maintenance'> & {
  vehicles?: { plate: string; nickname: string | null } | null;
};

export type VehicleFueling = Tables<'vehicle_fueling'> & {
  vehicles?: { plate: string; nickname: string | null } | null;
  drivers?: { name: string } | null;
};

export type VehicleOdometer = Tables<'vehicle_odometer'>;

export type CreateVehicleMaintenanceInput = Omit<TablesInsert<'vehicle_maintenance'>, 'tenant_id' | 'created_by'>;
export type UpdateVehicleMaintenanceInput = TablesUpdate<'vehicle_maintenance'> & { id: string };
export type CreateVehicleFuelingInput = Omit<TablesInsert<'vehicle_fueling'>, 'tenant_id' | 'created_by' | 'total_cost'>;

/* ─── Maintenance ─── */
export function useVehicleMaintenanceList(vehicleId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['vehicle_maintenance', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant) return [];
      const makeQuery=()=>{let q = supabase
        .from('vehicle_maintenance')
        .select('*, vehicles(plate, nickname)')
        .eq('tenant_id', currentTenant.id)
        .order('scheduled_date', { ascending: false, nullsFirst: false }).order('id');
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      return q;};
      return await fetchAllPostgrestPages((from,to)=>makeQuery().range(from,to)) as VehicleMaintenance[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateMaintenance() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateVehicleMaintenanceInput) => {
      const { data, error } = await supabase.from('vehicle_maintenance').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_maintenance'] }),
  });
}

export function useUpdateMaintenance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateVehicleMaintenanceInput) => {
      const { data, error } = await supabase.from('vehicle_maintenance')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_maintenance'] }),
  });
}

/* ─── Fueling ─── */
export function useVehicleFuelingList(vehicleId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['vehicle_fueling', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant) return [];
      const makeQuery=()=>{let q = supabase
        .from('vehicle_fueling')
        .select('*, vehicles(plate, nickname), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('fueled_at', { ascending: false }).order('id');
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      return q;};
      return await fetchAllPostgrestPages((from,to)=>makeQuery().range(from,to)) as VehicleFueling[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateFueling() {
  const { currentTenant } = useTenant();
  const {user}=useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateVehicleFuelingInput) => {
      if(!user)throw new Error('Usuário não autenticado');
      const payload = {
        ...values,
        tenant_id: currentTenant!.id,
      };
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant!.id,actorId:user.id,action:'create_vehicle_fueling',entityId:'new',payload});
      const { data, error } = await supabase.rpc('create_vehicle_fueling_with_odometer_v1', {
        _payload: {...payload,request_id:pending.requestId},
      });
      if (error) throw error;
      acknowledgeDurableOperatorCommand(pending);
      return data as Tables<'vehicle_fueling'>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle_fueling'] });
      qc.invalidateQueries({ queryKey: ['vehicle_odometer'] });
    },
  });
}

/* ─── Odometer ─── */
export function useVehicleOdometerList(vehicleId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['vehicle_odometer', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant) return [];
      const makeQuery=()=>{let q = supabase
        .from('vehicle_odometer')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('recorded_at', { ascending: false }).order('id');
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      return q;};
      return await fetchAllPostgrestPages((from,to)=>makeQuery().range(from,to)) as VehicleOdometer[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateOdometerReading() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { vehicle_id: string; reading_km: number; notes?: string }) => {
      const { data, error } = await supabase.from('vehicle_odometer').insert({
        ...values,
        tenant_id: currentTenant!.id,
        source: 'manual',
        created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_odometer'] }),
  });
}

/* ─── Consumption calculation ─── */
export function useConsumptionHistory(vehicleId?: string) {
  const query=useVehicleFuelingList(vehicleId);const fuelings=query.data??[];

  // Calculate km/l between consecutive full-tank fuelings
  const consumption = fuelings
    .filter(f => f.is_full_tank && f.odometer_km)
    .sort((a, b) => new Date(a.fueled_at).getTime() - new Date(b.fueled_at).getTime())
    .map((f, i, arr) => {
      if (i === 0) return null;
      const prev = arr[i - 1];
      const km = Number(f.odometer_km!) - Number(prev.odometer_km!);
      const liters = Number(f.liters);
      if (km <= 0 || liters <= 0) return null;
      return {
        date: f.fueled_at,
        km,
        liters,
        kmPerLiter: km / liters,
        costPerKm: f.total_cost ? Number(f.total_cost) / km : null,
      };
    })
    .filter(Boolean) as { date: string; km: number; liters: number; kmPerLiter: number; costPerKm: number | null }[];

  const avgKmPerLiter = consumption.length > 0
    ? consumption.reduce((s, c) => s + c.kmPerLiter, 0) / consumption.length
    : null;

  return { consumption, avgKmPerLiter, fuelings,isLoading:query.isLoading,isError:query.isError,error:query.error,refetch:query.refetch };
}
