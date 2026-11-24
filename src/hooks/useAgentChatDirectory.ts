import {useEffect,useRef} from 'react';
import {useInfiniteQuery,useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {useTenant} from './useTenant';
import {supabase} from '@/integrations/supabase/client';
import {parseAgentContacts,parseAgentInbox} from '@/lib/driver/agentChatDirectory';
import type {ChatCursor} from '@/lib/driver/chatCommands';

function useDirectoryScope(driverId?:string){
 const {user}=useAuth(),{currentTenant}=useTenant(),tenant=currentTenant?.id,actor=user?.id;
 const current=useRef({tenant,actor,driverId}),alive=useRef(true);current.current={tenant,actor,driverId};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 return {tenant,actor,assert:()=>{if(!alive.current||current.current.tenant!==tenant||current.current.actor!==actor||current.current.driverId!==driverId)throw new Error('A sessão do chat mudou.');}};
}
export function useAgentChatContacts(driverId:string){
 const {tenant,actor,assert}=useDirectoryScope(driverId),client=useQueryClient();
 const query=useQuery({queryKey:['agent-chat-contacts',tenant,actor,driverId],enabled:!!tenant&&!!actor&&!!driverId,retry:false,refetchInterval:15000,
  queryFn:async({signal})=>{const {data,error}=await supabase.rpc('list_driver_chat_agents',{_tenant_id:tenant!,_driver_id:driverId}).abortSignal(signal);
   if(error)throw error;assert();return parseAgentContacts(data,tenant!,actor!,driverId);}});
 useEffect(()=>{if(!tenant||!actor||!driverId)return;
  const channel=supabase.channel(`agent-contacts:${tenant}:${actor}:${driverId}`).on('postgres_changes',
   {event:'INSERT',schema:'public',table:'driver_direct_messages',filter:'driver_id=eq.'+driverId},
   ()=>void client.invalidateQueries({queryKey:['agent-chat-contacts',tenant,actor,driverId]})).subscribe();
  return()=>{void supabase.removeChannel(channel);};
 },[tenant,actor,driverId,client]);return query;
}
export function useAgentChatInbox(){
 const {tenant,actor,assert}=useDirectoryScope(),client=useQueryClient();
 const query=useInfiniteQuery({queryKey:['agent-chat-inbox',tenant,actor],enabled:!!tenant&&!!actor,retry:false,refetchInterval:15000,initialPageParam:null as ChatCursor|null,
  queryFn:async({pageParam,signal})=>{const {data,error}=await supabase.rpc('list_driver_agent_inbox',{_tenant_id:tenant!,_before:pageParam}).abortSignal(signal);
   if(error)throw error;assert();return parseAgentInbox(data,tenant!,actor!);},getNextPageParam:page=>page.next_cursor});
 useEffect(()=>{if(!tenant||!actor)return;
  const channel=supabase.channel(`agent-inbox:${tenant}:${actor}`).on('postgres_changes',
   {event:'INSERT',schema:'public',table:'driver_direct_messages',filter:'agent_user_id=eq.'+actor},
   ()=>void client.invalidateQueries({queryKey:['agent-chat-inbox',tenant,actor]})).subscribe();
  return()=>{void supabase.removeChannel(channel);};
 },[tenant,actor,client]);return query;
}
