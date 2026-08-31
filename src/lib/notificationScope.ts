import {useSyncExternalStore} from 'react';

let epoch=0;
const listeners=new Set<()=>void>();
const resetters=new Map<string,()=>void>();
const snapshot=()=>epoch;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};};

export const useNotificationScope=()=>useSyncExternalStore(subscribe,snapshot,snapshot);
export const isNotificationScopeCurrent=(scope:number)=>scope===epoch;
export const registerNotificationReset=(name:string,reset:()=>void)=>{resetters.set(name,reset);};

// Invalidate callbacks before clearing visible notifications. This does not
// abort submitted commands, erase durable outboxes or change server results.
export function resetNotificationScope(){
 epoch+=1;
 for(const reset of resetters.values())reset();
 for(const listener of listeners)listener();
}
