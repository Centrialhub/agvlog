import { z } from 'zod';
import type { ActiveTripLive, TripAlert } from './types';
const id = z.string().uuid(), number = z.number().finite().nullable(), text = z.string().nullable();
const severity = z.enum(['info','success','warning','danger','critical']);
const stop = z.object({id,sequence:z.number().int(),client_name:text,status:z.string(),
  planned_arrival_at:text.optional(),actual_arrival_at:text.optional(),actual_departure_at:text.optional(),
  latitude:z.number().min(-90).max(90).nullable().optional(),longitude:z.number().min(-180).max(180).nullable().optional()});
const trip = z.object({trip_id:id,tenant_id:id,trip_code:z.string(),trip_status:z.string(),tracking_enabled:z.boolean(),
  vehicle_id:id.nullable(),vehicle_plate:text,vehicle_name:text,driver_id:id.nullable(),driver_name:text,driver_phone:text,
  lat:z.number().min(-90).max(90).nullable(),lng:z.number().min(-180).max(180).nullable(),speed_kmh:number,heading:number,
  state:z.enum(['planned','tracking_disabled','unknown','normal','arriving','at_stop','stopped','delayed','off_route','no_signal','critical']),
  severity,status_message:text,
  route_geometry_geojson:z.object({type:z.literal('LineString'),coordinates:z.array(z.tuple([z.number().min(-180).max(180),z.number().min(-90).max(90)])).min(2)}).nullable(),
  distance_from_route_meters:number,delay_minutes:number,stopped_minutes:number,average_speed_kmh:number,
  eta_next_stop_at:text,last_signal_at:text,last_signal_age_seconds:number,position_captured_at:text,
  next_stop:stop.nullable(),previous_stops:z.array(stop),pending_stops:z.array(stop),
  loads:z.array(z.object({id,code:text,documents_count:z.number().int().nonnegative(),total_weight:number}))});
const alert = z.object({id,tenant_id:id,trip_id:id.nullable(),vehicle_id:id.nullable(),type:z.string(),severity,
  title:z.string(),message:text,status:z.literal('open'),opened_at:z.string()});
export function readTowerTrips(data: unknown, tenant: string): ActiveTripLive[] {
  const rows = z.array(trip).parse(data);
  if (rows.some(row => row.tenant_id !== tenant) || new Set(rows.map(row => row.trip_id)).size !== rows.length) throw new Error('Viagens incompatíveis com a empresa.');
  return rows.map(row => ({...row,next_stop:row.next_stop && {...row.next_stop,client_name:row.next_stop.client_name ?? 'Destino não informado'},
    previous_stops:row.previous_stops.map(s=>({...s,client_name:s.client_name??'Destino não informado'})),
    pending_stops:row.pending_stops.map(s=>({...s,client_name:s.client_name??'Destino não informado'}))}));
}
export function readTowerAlerts(data: unknown, tenant: string): TripAlert[] {
  const rows=z.array(alert).parse(data);
  if(rows.some(row=>row.tenant_id!==tenant))throw new Error('Alertas incompatíveis com a empresa.');return rows;
}
export function requireRouteResult(result: { data: unknown; error: unknown }) {
  if (result.error || !z.object({ok:z.literal(true)}).safeParse(result.data).success) throw new Error('O servidor não confirmou o cálculo da rota.');
}
export function escapeMarkerText(value: string) {
  return value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
}
