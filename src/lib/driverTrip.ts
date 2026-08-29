import type { Database } from '@/integrations/supabase/types';

type DispatchTripRow = Database['public']['Tables']['dispatch_trips']['Row'];

export interface DriverTripLoadSummary {
  id: string;
  load_number: string;
  origin: string | null;
  destination: string | null;
  status: string;
}

export interface DriverTripVehicleSummary {
  plate: string;
  nickname: string | null;
}

export interface CanonicalTripLoadLink {
  load_id: string;
  loads: DriverTripLoadSummary | null;
}

export interface CanonicalLoadTripLink {
  dispatch_trip_id: string;
  dispatch_trips: { status: string } | null;
}

export type DriverTripQueryRow = DispatchTripRow & {
  dispatch_trip_loads: CanonicalTripLoadLink[] | null;
  vehicles: DriverTripVehicleSummary | null;
};

export type DriverTrip = DispatchTripRow & {
  loads: DriverTripLoadSummary | null;
  vehicles: DriverTripVehicleSummary | null;
};

export const DRIVER_TRIP_SELECT = `
  *,
  dispatch_trip_loads!dispatch_trip_loads_dispatch_trip_id_fkey(
    load_id,
    loads!dispatch_trip_loads_load_id_fkey(
      id,
      load_number,
      origin,
      destination,
      status
    )
  ),
  vehicles!dispatch_trips_vehicle_id_fkey(plate, nickname)
`;

/**
 * Converts the canonical many-to-many trip/load relation into the primary load
 * shape consumed by the driver UI. The legacy dispatch_trips.load_id is used
 * only to choose among canonical links; it is never used to discover a link.
 */
export function normalizeDriverTrip(row: DriverTripQueryRow): DriverTrip {
  const links = row.dispatch_trip_loads ?? [];
  const selectedLink =
    links.find((link) => link.load_id === row.load_id) ??
    links.find((link) => link.loads !== null) ??
    null;
  const { dispatch_trip_loads: _links, ...trip } = row;

  return {
    ...trip,
    loads: selectedLink?.loads ?? null,
  };
}

export function resolveCanonicalTripLink(
  links: CanonicalLoadTripLink[] | null | undefined,
  activeStatuses: readonly string[],
): CanonicalLoadTripLink | null {
  if (!links?.length) return null;

  return (
    links.find((link) => link.dispatch_trips?.status && activeStatuses.includes(link.dispatch_trips.status)) ??
    links[0]
  );
}
