import type { QueryClient } from '@tanstack/react-query';

export const TRIP_LOAD_QUERY_KEYS = [
  'driver_active_trip','driver_my_trips','driver_my_loads','driver_all_assigned_loads',
  'driver_trip','driver_stops','dispatch_trips','loads','load','load_trip_state',
  'load-control','load-unloading','pending_loads_for_routing',
] as const;

export async function invalidateTripLoadQueries(client:QueryClient) {
  // A refresh failure must not mask the original mutation result/error. Failed
  // queries remain stale and their screens retain their normal retry controls.
  await Promise.allSettled(TRIP_LOAD_QUERY_KEYS.map(key=>client.invalidateQueries({queryKey:[key]})));
}

export function tripMutationError(error:unknown):Error & {code?:string} {
  const code=error && typeof error==='object' && 'code' in error && typeof error.code==='string'?error.code:undefined;
  const raw=error && typeof error==='object' && 'message' in error && typeof error.message==='string'?error.message:'';
  let message=raw || 'Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.';
  if(code && ['40001','40P01','55P03'].includes(code)){
    message='Outra operação alterou a viagem ou a carga. Atualize os dados e tente novamente; esta tentativa não foi confirmada.';
  }else if(raw.includes('trip_start_requires_reconciliation')){
    message='Carga e viagem têm registros divergentes. Solicite à operação a reconciliação do início; nenhum horário histórico será presumido.';
  }else if(raw.includes('trip_load_assignment_mismatch') || raw.includes('load_already_assigned_to_active_trip')){
    message='Os vínculos da carga com a viagem precisam de revisão pela operação. Atualize os dados antes de continuar.';
  }else if(raw.includes('trip_must_be_started_before_load')){
    message='A carga precisa estar vinculada a uma viagem iniciada. Confirme a partida ou a reatribuição com a operação.';
  }else if(raw.includes('planned_stop_coordinates_required')){
    message='O despacho foi bloqueado porque uma parada não possui latitude e longitude válidas. Corrija as coordenadas no planejamento.';
  }
  return Object.assign(new Error(message),{code});
}

export function isConfirmedTripStart(data:unknown,tripId:string):boolean {
  if(!data || typeof data!=='object')return false;
  return 'trip_id' in data && data.trip_id===tripId && 'status' in data
    && (data.status==='in_transit' || data.status==='in_progress')
    && 'load_ids' in data && Array.isArray(data.load_ids) && data.load_ids.length>0
    && data.load_ids.every(id=>typeof id==='string' && id.length>0);
}

export function isConfirmedLoadTransition(data:unknown,loadId:string,status:string):boolean {
  return Boolean(data && typeof data==='object' && 'load_id' in data && data.load_id===loadId
    && 'from_status' in data && typeof data.from_status==='string'
    && 'to_status' in data && data.to_status===status && 'changed' in data && typeof data.changed==='boolean');
}
