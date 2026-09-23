import type { Json } from '@/integrations/supabase/types';
import type { RoutePlanSnapshot } from '@/hooks/useRoutePlanningDrafts';
import type { RouteStopDraft,RouteStopRiskLevel,RouteStopSortMode } from './routePlanningTypes';

export interface ParsedRoutePlanSnapshot {snapshot:RoutePlanSnapshot;valid:boolean}
const objectValue=(value:unknown):Record<string,unknown>|null=>typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:null;
const stringValue=(value:unknown)=>typeof value==='string'?value:undefined;
const nullableString=(value:unknown)=>value===null?null:stringValue(value);
const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
const stringArray=(value:unknown)=>Array.isArray(value)&&value.every(item=>typeof item==='string')?value:undefined;

function parseStop(value:unknown):RouteStopDraft|null{
  const row=objectValue(value);if(!row)return null;
  const id=stringValue(row.id),recipient=stringValue(row.recipient_name),destination=stringValue(row.destination);
  const loadIds=stringArray(row.load_ids),documents=stringArray(row.fiscal_document_ids),invoices=stringArray(row.invoice_numbers);
  const weight=finite(row.total_weight_kg),volume=finite(row.total_volume_m3),pallets=finite(row.total_pallet_count),total=finite(row.total_value);
  const service=finite(row.service_time_minutes),priority=finite(row.priority);
  if(!id||recipient===undefined||destination===undefined||!loadIds||!documents||!invoices||weight===undefined||volume===undefined||pallets===undefined||total===undefined||service===undefined||priority===undefined)return null;
  const risk:RouteStopRiskLevel=row.risk_level==='warning'||row.risk_level==='critical'?row.risk_level:'normal';
  return {id,recipient_name:recipient,destination,load_ids:loadIds,fiscal_document_ids:documents,invoice_numbers:invoices,
    total_weight_kg:weight,total_volume_m3:volume,total_pallet_count:pallets,total_value:total,service_time_minutes:service,priority,risk_level:risk,
    client_id:nullableString(row.client_id),supplier_id:nullableString(row.supplier_id),city:nullableString(row.city),state:nullableString(row.state),neighborhood:nullableString(row.neighborhood),
    latitude:finite(row.latitude)??null,longitude:finite(row.longitude)??null,location_address:nullableString(row.location_address),location_provider:nullableString(row.location_provider),
    location_accuracy_m:finite(row.location_accuracy_m)??null,location_confidence:finite(row.location_confidence)??null,geofence_radius_m:finite(row.geofence_radius_m),
    location_exception_reason:nullableString(row.location_exception_reason),original_order:finite(row.original_order)??null,optimized_order:finite(row.optimized_order)??null,
    manual_order:finite(row.manual_order)??null,planned_arrival_at:nullableString(row.planned_arrival_at),estimated_departure_at:nullableString(row.estimated_departure_at),
    delivery_window_start:nullableString(row.delivery_window_start),delivery_window_end:nullableString(row.delivery_window_end),risk_reason:nullableString(row.risk_reason),notes:nullableString(row.notes),
    location_source:['address_geocoded','map_selected','imported','legacy_coordinates'].includes(String(row.location_source))?row.location_source as RouteStopDraft['location_source']:undefined,
    location_audit:objectValue(row.location_audit) as Json|null??undefined};
}

export function parseRoutePlanSnapshot(value:Json|null):ParsedRoutePlanSnapshot{
  const row=objectValue(value);if(!row)return {snapshot:{},valid:value===null};
  let valid=true;const snapshot:RoutePlanSnapshot={};
  const loadIds=stringArray(row.load_ids);if(loadIds)snapshot.load_ids=loadIds;else if(row.load_ids!==undefined)valid=false;
  if(Array.isArray(row.loads)&&row.loads.every(item=>{const value=objectValue(item);return Boolean(value&&typeof value.id==='string');}))snapshot.loads=row.loads as Array<{id:string}>;else if(row.loads!==undefined)valid=false;
  if(Array.isArray(row.stops)){const stops=row.stops.map(parseStop);if(stops.every((stop):stop is RouteStopDraft=>stop!==null))snapshot.stops=stops;else valid=false;}else if(row.stops!==undefined)valid=false;
  for(const key of ['vehicle_id','driver_id','planned_start_at','notes'] as const){const value=stringValue(row[key]);if(value!==undefined)snapshot[key]=value;else if(row[key]!==undefined&&row[key]!==null)valid=false;}
  if(['original','manual','smart','auto'].includes(String(row.sortMode)))snapshot.sortMode=row.sortMode as RouteStopSortMode;else if(row.sortMode!==undefined)valid=false;
  const transit=finite(row.initial_transit_minutes);if(transit!==undefined)snapshot.initial_transit_minutes=transit;else if(row.initial_transit_minutes!==undefined)valid=false;
  return {snapshot,valid};
}
