import {useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useAuth} from './useAuth';
import {useTenant} from './useTenant';

export function useLoadLiveUpdates(){
 const {currentTenant}=useTenant();const {user}=useAuth();const client=useQueryClient();
 const tenantId=currentTenant?.id,actorId=user?.id;
 useEffect(()=>{
  if(!tenantId||!actorId||typeof supabase.channel!=='function')return;
  const channel=supabase.channel(`load-updates:${tenantId}:${actorId}`)
   .on('postgres_changes',{event:'*',schema:'public',table:'loads',filter:`tenant_id=eq.${tenantId}`},()=>{
    void client.invalidateQueries({queryKey:['loads']});
    void client.invalidateQueries({queryKey:['load']});
   }).subscribe();
  return()=>{void supabase.removeChannel(channel);};
 },[tenantId,actorId,client]);
}
