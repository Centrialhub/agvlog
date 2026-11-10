import {supabase} from '@/integrations/supabase/client';
import type {LoadItem} from '@/hooks/useLoadItems';
import type {RoutePlanningDraft} from '@/hooks/useRoutePlanningDrafts';
import {fetchAllPostgrestPages} from '@/lib/supabase/fetchAllPages';
import {geocodeAddress,locationFromCandidate,type ResolvedLocation} from '@/lib/geocoding';
import {consolidateLoadsIntoStops,type ConsolidationLoadItem} from './stopConsolidation';
import {parseRoutePlanSnapshot} from './routePlanSnapshot';
import {routeStopOrder} from './routeStopOrder';
import {autoSequenceStops} from './simpleStopSequencing';
import {hasValidStopCoordinates} from './stopCoordinates';
import type {RouteStopDraft} from './routePlanningTypes';

export interface LoadDispatchPreparation {
 stops:RouteStopDraft[]; draftId?:string; draftVersion?:string;
 driverId?:string; vehicleId?:string; plannedStart?:string; name:string;
}
interface RoutingClient {
 id:string;address_street:string|null;address_number:string|null;address_complement:string|null;
 address_neighborhood:string|null;address_city:string|null;address_state:string|null;address_zip:string|null;
 address_geocode_status:string|null;address_lat:number|null;address_lng:number|null;
 address_geocode_hash:string|null;address_geocode_provider:string|null;address_geocode_accuracy_m:number|null;
 address_geocode_confidence:number|null;
}
export function stopLocation(stop:RouteStopDraft):ResolvedLocation|null {
 if(!hasValidStopCoordinates(stop)||!['address_geocoded','map_selected'].includes(stop.location_source||''))return null;
 return {latitude:stop.latitude!,longitude:stop.longitude!,source:stop.location_source as ResolvedLocation['source'],
  address:stop.location_address||stop.destination,provider:stop.location_provider||null,
  accuracy_m:stop.location_accuracy_m??null,confidence:stop.location_confidence??null,audit:stop.location_audit||{}};
}
export function savedLoadDispatchPlan(drafts:RoutePlanningDraft[],tenant:string,loadId:string,documents:string[]):LoadDispatchPreparation|null {
 const matching=drafts.filter(d=>d.tenant_id===tenant&&d.status==='draft'&&d.load_ids?.includes(loadId));
 if(matching.length>1)throw new Error('Há mais de um planejamento para esta carga. Revise a Roteirização antes de despachar.');
 const draft=matching[0];if(!draft)return null;
 if(draft.load_ids?.length!==1)throw new Error('Esta carga pertence a uma rota com outras cargas. Despache a rota completa pela Roteirização.');
 const parsed=parseRoutePlanSnapshot(draft.route_config),stops=parsed.snapshot.stops||[];
 const assigned=stops.flatMap(s=>s.fiscal_document_ids);
 if(!parsed.valid||!stops.length||assigned.length!==documents.length||new Set(assigned).size!==documents.length
  ||documents.some(id=>!assigned.includes(id))||stops.some(s=>s.load_ids.length!==1||s.load_ids[0]!==loadId))
  throw new Error('A composição da carga mudou ou o planejamento está incompleto. Atualize a Roteirização antes de despachar.');
 return {stops:[...stops].sort((a,b)=>routeStopOrder(a)-routeStopOrder(b)),draftId:draft.id,draftVersion:draft.updated_at,
  driverId:draft.driver_id||parsed.snapshot.driver_id,vehicleId:draft.vehicle_id||parsed.snapshot.vehicle_id,
  plannedStart:draft.planned_start_at||parsed.snapshot.planned_start_at,name:draft.name};
}
export async function resolveAutomaticStopLocations(stops:RouteStopDraft[],signal:AbortSignal,
 searchable:ReadonlySet<string>,search=geocodeAddress,tenant=''):Promise<RouteStopDraft[]> {
 const cache=new Map<string,Promise<ResolvedLocation|null>>();let next=0;
 const result=[...stops];
 async function worker(){while(next<stops.length){signal.throwIfAborted();const index=next++,stop=stops[index];
  if(stopLocation(stop)||(stop.location_exception_reason?.trim().length??0)>=20||!stop.client_id||!searchable.has(stop.client_id))continue;
  const address=stop.location_address?.trim();if(!address)continue;
  if(!cache.has(address))cache.set(address,(async()=>{try{const candidates=await search(tenant,address);
   signal.throwIfAborted();const c=candidates[0];
   // Multiple or approximate matches remain visible for review, never guessed.
   return candidates.length===1&&c.confidence>=0.8&&c.accuracy_m<=150?locationFromCandidate(c,address):null;
  }catch(error){if(signal.aborted)throw error;return null;}})());
  const location=await cache.get(address)!;signal.throwIfAborted();
  if(location)result[index]={...stop,latitude:location.latitude,longitude:location.longitude,location_source:location.source,
   location_address:location.address,location_provider:location.provider,location_accuracy_m:location.accuracy_m,
   location_confidence:location.confidence,location_audit:location.audit};
 }}
 await Promise.all(Array.from({length:Math.min(3,stops.length)},worker));return result;
}
export async function prepareLoadDispatch(tenant:string,load:{id:string;load_number:string;destination:string|null},
 items:LoadItem[],signal:AbortSignal):Promise<LoadDispatchPreparation>{
 const documents=[...new Set(items.flatMap(i=>i.fiscal_document_id?[i.fiscal_document_id]:[]))];
 if(!documents.length||items.some(i=>!i.fiscal_document_id))throw new Error('Revise os documentos da carga antes de preparar o despacho.');
 const drafts=await fetchAllPostgrestPages<RoutePlanningDraft>((from,to)=>supabase.from('route_planning_drafts')
  .select('*').eq('tenant_id',tenant).eq('status','draft').contains('load_ids',[load.id]).order('id').range(from,to).abortSignal(signal));
 const saved=savedLoadDispatchPlan(drafts,tenant,load.id,documents);
 type Doc=NonNullable<ConsolidationLoadItem['fiscal_documents']>&{id:string};
 const docs:Doc[]=[];
 for(let n=0;n<documents.length;n+=100){signal.throwIfAborted();docs.push(...await fetchAllPostgrestPages<Doc>((from,to)=>supabase.from('fiscal_documents')
  .select('id,invoice_number,recipient,recipient_city,recipient_state,recipient_neighborhood,client_id,supplier_id,value,weight_kg')
  .eq('tenant_id',tenant).in('id',documents.slice(n,n+100)).is('deleted_at',null).order('id').range(from,to).abortSignal(signal)));}
 if(documents.some(id=>!docs.some(d=>d.id===id)))throw new Error('Uma nota da carga não está disponível. Atualize a página antes de despachar.');
 if(saved?.stops.some(s=>s.fiscal_document_ids.some(id=>(docs.find(d=>d.id===id)?.client_id||null)!==(s.client_id||null))))
  throw new Error('O destinatário de uma nota mudou. Atualize a Roteirização antes de despachar.');
 const ids=[...new Set(docs.flatMap(d=>d.client_id?[d.client_id]:[]))],clients:RoutingClient[]=[];
 for(let n=0;n<ids.length;n+=100){signal.throwIfAborted();const {data,error}=await supabase.rpc('get_routing_client_locations_v1' as never,
  {_tenant_id:tenant,_client_ids:ids.slice(n,n+100)} as never).abortSignal(signal);
  if(error)throw error;clients.push(...(data||[]) as unknown as RoutingClient[]);}
 const byId=new Map(clients.map(c=>[c.id,c]));const searchable=new Set<string>();
 const enriched=items.map(item=>{const doc=docs.find(d=>d.id===item.fiscal_document_id)!;const c=byId.get(doc.client_id||'');
  const address=c?[c.address_street,c.address_number,c.address_complement,c.address_neighborhood,c.address_city,c.address_state,c.address_zip].filter(Boolean).join(', '):null;
  if(c?.address_street&&c.address_city&&c.address_state)searchable.add(c.id);
  return {...item,fiscal_documents:{...doc,client_address:address,client_location:c?.address_geocode_status==='verified'
   &&c.address_lat!=null&&c.address_lng!=null&&c.address_geocode_hash?{latitude:Number(c.address_lat),longitude:Number(c.address_lng),
    provider:c.address_geocode_provider,accuracy_m:c.address_geocode_accuracy_m,confidence:c.address_geocode_confidence,address_hash:c.address_geocode_hash}:null}};
 });
 const stops=saved?.stops||autoSequenceStops(consolidateLoadsIntoStops([{...load,items:enriched}]));
 return {...saved,name:saved?.name||`Carga ${load.load_number}`,stops:await resolveAutomaticStopLocations(stops,signal,searchable,geocodeAddress,tenant)};
}
export async function assertLoadDispatchDraftCurrent(tenant:string,plan:LoadDispatchPreparation){
 if(!plan.draftId)return;
 const {data,error}=await supabase.from('route_planning_drafts').select('updated_at,status').eq('tenant_id',tenant).eq('id',plan.draftId).maybeSingle();
 if(error)throw error;
 if(data?.status!=='draft'||data.updated_at!==plan.draftVersion)throw new Error('A rota foi alterada em outra tela. Feche e abra o despacho novamente.');
}
