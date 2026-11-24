import {useEffect,useMemo,useState} from 'react';
import {useAuth} from './useAuth';
import {useTenant} from './useTenant';
import {chatError} from '@/lib/driver/chatCommands';
import {CHAT_OUTBOX_CHANGED,pendingAgentChatScopes} from '@/lib/driver/chatOutbox';
export function usePendingAgentChats(){
 const {user}=useAuth(),{currentTenant}=useTenant(),tenant=currentTenant?.id,actor=user?.id;
 const [revision,setRevision]=useState(0);
 useEffect(()=>{const changed=()=>setRevision(n=>n+1);window.addEventListener('storage',changed);window.addEventListener(CHAT_OUTBOX_CHANGED,changed);
  return()=>{window.removeEventListener('storage',changed);window.removeEventListener(CHAT_OUTBOX_CHANGED,changed);};},[]);
 return useMemo(()=>{try{return {revision,threads:tenant&&actor?pendingAgentChatScopes(window.localStorage,tenant,actor):[],error:null};}
  catch(error){return {revision,threads:[],error:chatError(error)};}},[tenant,actor,revision]);
}
