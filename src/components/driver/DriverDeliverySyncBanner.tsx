import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { CloudUpload, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useTenant } from '@/hooks/useTenant';
import { replayPendingDeliverySubmissions } from '@/lib/driver/driverDeliverySubmission';
import { supabase } from '@/integrations/supabase/client';
import { DRIVER_OFFLINE_OUTBOX_CHANGED } from '@/lib/driver/driverOfflineOutbox';

export function DriverDeliverySyncBanner(){
  const {currentTenant}=useTenant();const {user}=useAuth();const isOnline=useOnlineStatus();const wasOnline=useRef(isOnline);
  const tenant=currentTenant?.id,actor=user?.id;
  const query=useQuery({queryKey:['driver_delivery_outbox_replay',tenant,actor],enabled:!!tenant&&!!actor,retry:false,staleTime:Infinity,
    queryFn:()=>replayPendingDeliverySubmissions(tenant!,actor!)});
  const refetch=query.refetch;
  useEffect(()=>{if(isOnline&&!wasOnline.current)void refetch();wasOnline.current=isOnline;},[isOnline,refetch]);
  useEffect(()=>{
    const replayAfterPredecessor=()=>{if(isOnline)setTimeout(()=>void refetch(),0);};
    window.addEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,replayAfterPredecessor);
    return()=>window.removeEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,replayAfterPredecessor);
  },[isOnline,refetch]);
  useEffect(()=>{
    const replayAfterPredecessor=()=>{if(isOnline)setTimeout(()=>void refetch(),0);};
    window.addEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,replayAfterPredecessor);
    return()=>window.removeEventListener(DRIVER_OFFLINE_OUTBOX_CHANGED,replayAfterPredecessor);
  },[isOnline,refetch]);
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event==='TOKEN_REFRESHED'&&isOnline)setTimeout(()=>void refetch(),0);
    });
    return()=>subscription.unsubscribe();
  },[isOnline,refetch]);
  if(query.error)return <Link to="/driver/sync" className="flex items-center justify-center gap-2 bg-destructive/10 px-4 py-2 text-center text-xs text-destructive">
    <AlertTriangle aria-hidden="true" className="h-4 w-4"/>Não foi possível ler os envios pendentes. Toque para revisar.
  </Link>;
  if(!query.data?.pending)return null;
  return <Link to="/driver/sync" className="flex items-center justify-center gap-2 bg-primary/10 px-4 py-2 text-center text-xs text-primary">
    <CloudUpload aria-hidden="true" className="h-4 w-4"/>{query.data.pending} {query.data.pending===1?'envio salvo aguarda':'envios salvos aguardam'} sincronização.
  </Link>;
}
