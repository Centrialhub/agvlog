import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

/* ─── Types ─── */
export interface VehicleMaintenance {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  maintenance_type: string;
  category: string;
  description: string;
  status: string;
  scheduled_date: string | null;
  completed_date: string | null;
  odometer_at_service: number | null;
  next_odometer: number | null;
  next_date: string | null;
  cost: number | null;
  vendor: string | null;
  notes: string | null;
  created_at: string;
  vehicles?: { plate: string; nickname: string | null } | null;
}

export interface VehicleFueling {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  driver_id: string | null;
  dispatch_trip_id: string | null;
  fueled_at: string;
  liters: number;
  price_per_liter: number | null;
  total_cost: number | null;
  fuel_type: string;
  odometer_km: number | null;
  station_name: string | null;
  is_full_tank: boolean;
  notes: string | null;
  created_at: string;
  vehicles?: { plate: string; nickname: string | null } | null;
  drivers?: { name: string } | null;
}

export interface VehicleOdometer {
  id: string;
  vehicle_id: string;
  reading_km: number;
  source: string;
  recorded_at: string;
  notes: string | null;
}

/* ─── Maintenance ─── */
export function useVehicleMaintenanceList(vehicleId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['vehicle_maintenance', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = (supabase as any)
        .from('vehicle_maintenance')
        .select('*, vehicles(plate, nickname)')
        .eq('tenant_id', currentTenant.id)
        .order('scheduled_date', { ascending: false, nullsFirst: false });
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VehicleMaintenance[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateMaintenance() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<VehicleMaintenance>) => {
      const { data, error } = await (supabase as any).from('vehicle_maintenance').insert({
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
    mutationFn: async ({ id, ...values }: Partial<VehicleMaintenance> & { id: string }) => {
      const { data, error } = await (supabase as any).from('vehicle_maintenance')
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
      let q = (supabase as any)
        .from('vehicle_fueling')
        .select('*, vehicles(plate, nickname), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('fueled_at', { ascending: false });
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VehicleFueling[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateFueling() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<VehicleFueling>) => {
      const payload: any = {
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      };
      // Auto-calculate total_cost
      if (payload.liters && payload.price_per_liter) {
        payload.total_cost = Number(payload.liters) * Number(payload.price_per_liter);
      }
      const { data, error } = await (supabase as any).from('vehicle_fueling').insert(payload).select().single();
      if (error) throw error;

      // Also record odometer reading if provided
      if (values.odometer_km && values.vehicle_id) {
        await (supabase as any).from('vehicle_odometer').insert({
          tenant_id: currentTenant!.id,
          vehicle_id: values.vehicle_id,
          reading_km: values.odometer_km,
          source: 'fueling',
          created_by: user?.id,
        });
        qc.invalidateQueries({ queryKey: ['vehicle_odometer'] });
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicle_fueling'] }),
  });
}

/* ─── Odometer ─── */
export function useVehicleOdometerList(vehicleId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['vehicle_odometer', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = (supabase as any)
        .from('vehicle_odometer')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('recorded_at', { ascending: false });
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VehicleOdometer[];
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
      const { data, error } = await (supabase as any).from('vehicle_odometer').insert({
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
  const { data: fuelings = [] } = useVehicleFuelingList(vehicleId);

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

  return { consumption, avgKmPerLiter, fuelings };
}
