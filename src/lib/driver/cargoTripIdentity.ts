import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { DRIVER_TRIP_SELECT } from '@/lib/driverTrip';

export interface CargoTripScope {
  tenantId: string;
  actorId: string;
  driverId: string;
  tripId: string;
}

export interface CargoTripIdentity {
  tripId: string;
  tenantId: string;
  driverId: string;
  vehicleId: string | null;
  plate: string | null;
  loads: Array<{ id: string; loadNumber: string; origin: string | null; destination: string | null; status: string }>;
}

const nullableText = z.string().nullable();
const identitySchema = z.object({
  id: z.string().uuid(), tenant_id: z.string().uuid(), driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable(),
  vehicles: z.object({ plate: nullableText }).nullable(),
  dispatch_trip_loads: z.array(z.object({
    load_id: z.string().uuid(),
    loads: z.object({ id: z.string().uuid(), load_number: nullableText,
      origin: nullableText, destination: nullableText, status: z.string() }).nullable(),
  })).nullable(),
});

export const cargoTripIdentityKey = (scope: CargoTripScope) => [
  'driver_cargo_trip_identity', scope.tenantId, scope.actorId, scope.driverId, scope.tripId,
] as const;

export async function getDriverCargoTripIdentity(scope: CargoTripScope, signal?: AbortSignal): Promise<CargoTripIdentity | null> {
  if (!scope.actorId || !scope.tenantId || !scope.driverId || !scope.tripId) {
    throw new Error('Identidade da viagem indisponível.');
  }
  let query = supabase.from('dispatch_trips').select(DRIVER_TRIP_SELECT)
    .eq('id', scope.tripId).eq('tenant_id', scope.tenantId).eq('driver_id', scope.driverId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('Não foi possível consultar a identificação da viagem.');
  if (!data) return null;
  const parsed = identitySchema.safeParse(data);
  if (!parsed.success || parsed.data.id !== scope.tripId || parsed.data.tenant_id !== scope.tenantId
    || parsed.data.driver_id !== scope.driverId) throw new Error('Identificação da viagem fora do contexto atual.');
  const row = parsed.data;
  const seen = new Set<string>();
  const loads: CargoTripIdentity['loads'] = [];
  for (const link of row.dispatch_trip_loads ?? []) {
    if (seen.has(link.load_id) || (link.loads && link.loads.id !== link.load_id)) {
      throw new Error('Vínculos de cargas inconsistentes. Atualize a viagem.');
    }
    seen.add(link.load_id);
    loads.push({ id: link.load_id, loadNumber: link.loads?.load_number?.trim() ?? '',
      origin: link.loads?.origin ?? null, destination: link.loads?.destination ?? null,
      status: link.loads?.status ?? '' });
  }
  return { tripId: row.id, tenantId: row.tenant_id, driverId: row.driver_id,
    vehicleId: row.vehicle_id, plate: row.vehicles?.plate?.trim() || null, loads };
}
