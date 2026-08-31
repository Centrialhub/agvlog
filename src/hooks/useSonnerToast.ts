import {useMemo,cloneElement,isValidElement,type MouseEventHandler} from 'react';
import {toast as sonner,type ExternalToast} from 'sonner';
import {useAlertStore} from '@/hooks/useAlertStore';
import {isNotificationScopeCurrent,registerNotificationReset,useNotificationScope} from '@/lib/notificationScope';

let sequence=0;
registerNotificationReset('sonner',()=>{
 // Dismiss alone retains private text and callbacks in the SDK's history.
 // Scrub it through public APIs, including notices already closed by the user.
 for(const toast of sonner.getHistory()){
  if('dismiss' in toast)continue;
  if(toast.title||toast.description||toast.action||toast.cancel||toast.icon||toast.onDismiss||toast.onAutoClose){
   sonner.message('',{id:toast.id,description:undefined,action:undefined,cancel:undefined,icon:undefined,onDismiss:undefined,onAutoClose:undefined});
   sonner.dismiss(toast.id);
  }
 }
});
type Message=Parameters<typeof sonner.success>[0];

export function useSonnerToast(){
 const scope=useNotificationScope();
 return useMemo(()=>{
  const current=()=>isNotificationScopeCurrent(scope);
  const prefix='notice:'+scope+':';
  const idFor=(id?:string|number)=>typeof id==='string'&&id.startsWith(prefix)?id:prefix+(id??++sequence);
  const actionFor=(action:ExternalToast['action']):ExternalToast['action']=>{
   if(action&&typeof action==='object'&&'onClick' in action)return {...action,onClick:event=>{if(current())action.onClick(event);}};
   if(isValidElement<{onClick?:MouseEventHandler}>(action))return cloneElement(action,{onClick:event=>{if(current())action.props.onClick?.(event);}});
   return action;
  };
  const dataFor=(data:ExternalToast={}):ExternalToast=>({...data,id:idFor(data.id),action:actionFor(data.action),cancel:actionFor(data.cancel),
   onDismiss:toast=>{if(current())data.onDismiss?.(toast);},onAutoClose:toast=>{if(current())data.onAutoClose?.(toast);}});
  const publish=(type:'success'|'info'|'message'|'loading',message:Message,data?:ExternalToast)=>current()?sonner[type](message,dataFor(data)):'obsolete-notice';
  const alert=(type:'error'|'warning',message:Message,data?:ExternalToast)=>{
   if(!current())return 'obsolete-notice';
   if(data?.id!==undefined)sonner.dismiss(idFor(data.id));
   useAlertStore.getState().showAlert(String(message),String(data?.description??''),type);
   return 'alert-popup';
  };
  return {
   success:(message:Message,data?:ExternalToast)=>publish('success',message,data),
   info:(message:Message,data?:ExternalToast)=>publish('info',message,data),
   message:(message:Message,data?:ExternalToast)=>publish('message',message,data),
   loading:(message:Message,data?:ExternalToast)=>publish('loading',message,data),
   error:(message:Message,data?:ExternalToast)=>alert('error',message,data),
   warning:(message:Message,data?:ExternalToast)=>alert('warning',message,data),
   dismiss:(id?:string|number)=>{if(!current())return 'obsolete-notice';if(id!==undefined)return sonner.dismiss(idFor(id));for(const toast of sonner.getToasts())sonner.dismiss(toast.id);return 'dismissed-notices';},
  };
 },[scope]);
}
