import {
  CircleDot,
  Flag,
  Fuel,
  MapPin,
  Moon,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { TablesInsert } from '@/integrations/supabase/types';

export type WaypointType = NonNullable<TablesInsert<'route_waypoints'>['waypoint_type']>;

export interface Waypoint {
  id?: string;
  waypoint_order: number;
  waypoint_type: WaypointType;
  label: string;
  address: string;
  poi_id: string | null;
  geofence_id: string | null;
  estimated_duration_min: number | null;
  notes: string;
}

interface WaypointTypeConfig {
  value: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const WAYPOINT_TYPES: readonly WaypointTypeConfig[] = [
  { value: 'origin', label: 'Origem', icon: Flag, color: 'text-green-500' },
  { value: 'destination', label: 'Destino', icon: MapPin, color: 'text-red-500' },
  { value: 'fueling', label: 'Abastecimento', icon: Fuel, color: 'text-amber-500' },
  { value: 'overnight', label: 'Pernoite', icon: Moon, color: 'text-indigo-500' },
  { value: 'meal', label: 'Refeição', icon: UtensilsCrossed, color: 'text-orange-500' },
  { value: 'client', label: 'Cliente/Entrega', icon: MapPin, color: 'text-blue-500' },
  { value: 'checkpoint', label: 'Ponto de passagem', icon: CircleDot, color: 'text-muted-foreground' },
];

const FALLBACK_WAYPOINT_TYPE = WAYPOINT_TYPES[6];

export const getWaypointTypeConfig = (type: string): WaypointTypeConfig =>
  WAYPOINT_TYPES.find(({ value }) => value === type) || FALLBACK_WAYPOINT_TYPE;

export const createEmptyWaypoint = (order: number, type: WaypointType = 'checkpoint'): Waypoint => ({
  waypoint_order: order,
  waypoint_type: type,
  label: '',
  address: '',
  poi_id: null,
  geofence_id: null,
  estimated_duration_min: null,
  notes: '',
});
