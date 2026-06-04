export type TripLiveState =
  | 'normal' | 'arriving' | 'at_stop' | 'stopped'
  | 'delayed' | 'off_route' | 'no_signal' | 'critical';

export type TripLiveSeverity = 'info' | 'success' | 'warning' | 'danger' | 'critical';

export interface ActiveTripLiveStop {
  id: string;
  sequence: number;
  client_name: string;
  planned_arrival_at?: string | null;
  actual_arrival_at?: string | null;
  actual_departure_at?: string | null;
  status: string;
}

export interface ActiveTripLiveLoad {
  id: string;
  code?: string | null;
  documents_count?: number | null;
  total_weight?: number | null;
}

export interface ActiveTripLive {
  trip_id: string;
  trip_code: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  vehicle_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  heading: number | null;
  state: TripLiveState;
  severity: TripLiveSeverity;
  status_message: string | null;
  route_geometry_geojson: { type: 'LineString'; coordinates: [number, number][] } | null;
  distance_from_route_meters: number | null;
  delay_minutes: number | null;
  stopped_minutes: number | null;
  average_speed_kmh: number | null;
  eta_next_stop_at: string | null;
  last_signal_at: string | null;
  last_signal_age_seconds: number | null;
  position_captured_at: string | null;
  next_stop: ActiveTripLiveStop | null;
  previous_stops: ActiveTripLiveStop[];
  pending_stops: ActiveTripLiveStop[];
  loads: ActiveTripLiveLoad[];
}

export interface TripAlert {
  id: string;
  tenant_id: string;
  trip_id: string | null;
  vehicle_id: string | null;
  type: string;
  severity: TripLiveSeverity;
  title: string;
  message: string | null;
  status: string;
  opened_at: string;
}

export const STATE_LABELS: Record<TripLiveState, string> = {
  normal: 'Em rota',
  arriving: 'Chegando',
  at_stop: 'Na parada',
  stopped: 'Parado',
  delayed: 'Atrasado',
  off_route: 'Fora da rota',
  no_signal: 'Sem sinal',
  critical: 'Crítico',
};

export const STATE_COLORS: Record<TripLiveState, string> = {
  normal: '#2563eb',
  arriving: '#0ea5e9',
  at_stop: '#16a34a',
  stopped: '#facc15',
  delayed: '#f97316',
  off_route: '#dc2626',
  no_signal: '#6b7280',
  critical: '#991b1b',
};

export const SEVERITY_ORDER: Record<TripLiveSeverity, number> = {
  critical: 1, danger: 2, warning: 3, info: 4, success: 5,
};