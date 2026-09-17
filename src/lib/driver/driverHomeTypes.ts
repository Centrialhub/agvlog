export interface DriverHomeAssignedLoad {
  id: string;
  load_number: string;
  origin: string | null;
  destination: string | null;
  status: string;
  total_pallet_count: number | null;
  total_weight_kg: number | null;
  scheduled_load_at: string | null;
  vehicles: { plate: string; nickname: string | null } | null;
  dispatch_trip_loads: Array<{
    dispatch_trip_id: string;
    dispatch_trips: { status: string } | null;
  }>;
}
