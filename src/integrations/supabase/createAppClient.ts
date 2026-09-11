import {createClient, type SupportedStorage} from '@supabase/supabase-js';
import type {Database} from './types';
import {coordinateAuthMethods} from '@/lib/auth/authSessionCoordination';
import {boundedAuthFetch} from '@/lib/auth/boundedAuthFetch';
import {activeTenantFetch} from '@/lib/tenant/activeTenantContext';

export function createAppClient<Schema=Database>(url:string,key:string,options:{storage:SupportedStorage;fetch?:typeof fetch;storageKey?:string;autoRefreshToken?:boolean;detectSessionInUrl?:boolean}){
  const projectOrigin=new URL(url).origin;
  const storageKey=options.storageKey??'sb-'+new URL(url).hostname.split('.')[0]+'-auth-token';
  const fetcher=boundedAuthFetch(projectOrigin,activeTenantFetch(projectOrigin,options.fetch));
  const client=createClient<Schema>(url,key,{
    auth:{storage:options.storage,persistSession:true,storageKey,autoRefreshToken:options.autoRefreshToken??true,
      detectSessionInUrl:options.detectSessionInUrl??true},
    global:{fetch:fetcher},
  });
  coordinateAuthMethods(client.auth,storageKey,options.storage);
  return client;
}
