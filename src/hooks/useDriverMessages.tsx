import {useEffect,useRef} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {supabase} from '@/integrations/supabase/client';
import {useTenant} from './useTenant';
import {useAuth} from './useAuth';
import {parseChatContext,parseChatPage,type ChatCursor} from '@/lib/driver/chatCommands';
function useScope(driverId:string|null|undefined,eventId?:string){
 const {currentTenant}=useTenant(),{user}=useAuth(),tenant=currentTenant?.id,actor=user?.id,latest=useRef({tenant,actor,driverId,eventId}),alive=useRef(true);
 latest.current={tenant,actor,driverId,eventId};useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const assert=()=>{if(!alive.current||latest.current.tenant!==tenant||latest.current.actor!==actor||latest.current.driverId!==driverId||latest.current.eventId!==eventId)throw new Error('A sessão ou conversa mudou.');};
 return {tenant,actor,assert,enabled:!!tenant&&!!actor&&!!(eventId||driverId),kind:eventId?'event':'driver',id:eventId||driverId};
}
export function useDriverChatContext(driverId:string|null|undefined,eventId?:string){
 const {tenant,actor,assert,enabled,kind,id}=useScope(driverId,eventId);
 return useQuery({queryKey:['driver-chat-context',tenant,actor,kind,id],enabled,retry:false,refetchInterval:15000,
  queryFn:async({signal})=>{const request=eventId?supabase.rpc('get_event_chat_context',{_tenant_id:tenant!,_event_id:eventId}):supabase.rpc('get_driver_chat_context',{_tenant_id:tenant!,_driver_id:driverId!});
   const {data,error}=await request.abortSignal(signal);if(error)throw error;assert();return parseChatContext(data,tenant!,actor!,driverId??null,eventId);}});
}
export function useDriverMessages(driverId:string|null|undefined,eventId?:string){
 const {tenant,actor,assert,enabled,kind,id}=useScope(driverId,eventId),client=useQueryClient();
 const query=useInfiniteQuery({queryKey:['driver-chat',tenant,actor,kind,id],enabled,retry:false,refetchInterval:15000,initialPageParam:null as ChatCursor|null,
  queryFn:async({pageParam,signal})=>{const request=eventId?supabase.rpc('list_event_chat_messages',{_tenant_id:tenant!,_event_id:eventId,_before:pageParam}):supabase.rpc('list_driver_chat_messages',{_tenant_id:tenant!,_driver_id:driverId!,_before:pageParam});
   const {data,error}=await request.abortSignal(signal);if(error)throw error;assert();return parseChatPage(data,tenant!,actor!,driverId??null,eventId);},getNextPageParam:page=>page.next_cursor});
 useEffect(()=>{
  if(!enabled)return;
  const channel=supabase.channel('chat:'+tenant+':'+actor+':'+kind+':'+id).on('postgres_changes',
   {event:'INSERT',schema:'public',table:kind==='event'?'operational_event_messages':'driver_direct_messages',filter:(kind==='event'?'event_id':'driver_id')+'=eq.'+id},
   ()=>{void client.invalidateQueries({queryKey:['driver-chat',tenant,actor,kind,id]});}).subscribe();
  return()=>{void supabase.removeChannel(channel);};
 },[enabled,tenant,actor,kind,id,client]);
 return query;
}
