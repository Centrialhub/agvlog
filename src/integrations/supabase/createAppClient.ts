import {createClient, type SupportedStorage} from '@supabase/supabase-js';
import type {Database} from './types';
import {AUTH_LOCK_TIMEOUT,authSessionLock,coordinateAuthMethods} from '@/lib/auth/authSessionCoordination';
import {boundedAuthFetch} from '@/lib/auth/boundedAuthFetch';

export function createAppClient<Schema=Database>(url:string,key:string,options:{storage:SupportedStorage;fetch?:typeof fetch;storageKey?:string;autoRefreshToken?:boolean;detectSessionInUrl?:boolean}){
  const storageKey=options.storageKey??'sb-'+new URL(url).hostname.split('.')[0]+'-auth-token';
  const client=createClient<Schema>(url,key,{
    auth:{storage:options.storage,persistSession:true,storageKey,autoRefreshToken:options.autoRefreshToken??true,
      detectSessionInUrl:options.detectSessionInUrl??true,lock:authSessionLock,lockAcquireTimeout:AUTH_LOCK_TIMEOUT},
    global:{fetch:boundedAuthFetch(new URL(url).origin,options.fetch)},
  });
  coordinateAuthMethods(client.auth,storageKey,options.storage);
  return client;
}
