import {AuthError, type SupabaseClient, type SupportedStorage} from '@supabase/supabase-js';

export const AUTH_LOCK_TIMEOUT = 7000;
export const hasSharedAuthLock = () => typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';
class AuthLockTimeout extends Error { readonly isAcquireTimeout = true; }
const queues = new Map<string, Promise<unknown>>();

// Never steal a held lock: its callback (and an Auth session write) can still run.
// The in-process fallback keeps reads/logout usable. AAL1 MFA is disabled by the
// gate without Web Locks, because this fallback cannot coordinate browser tabs.
export async function authSessionLock<T>(name:string,timeout:number,work:()=>Promise<T>):Promise<T>{
  if(hasSharedAuthLock()){
    const controller=new AbortController();
    const timer=timeout>0?setTimeout(()=>controller.abort(),timeout):undefined;
    try{
      return await navigator.locks.request(name,timeout===0?{mode:'exclusive',ifAvailable:true}:{mode:'exclusive',signal:controller.signal},async lock=>{
        clearTimeout(timer);
        if(!lock)throw new AuthLockTimeout('Outra operação de autenticação está em andamento. Tente novamente.');
        return work();
      });
    }catch(error){
      if(controller.signal.aborted)throw new AuthLockTimeout('Aguarde a operação de autenticação em andamento e tente novamente.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  const previous=queues.get(name)??Promise.resolve();
  let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
  const operation=previous.catch(()=>undefined).then(()=>{
    clearTimeout(timer);
    if(expired)throw new AuthLockTimeout('Outra operação de autenticação está em andamento. Tente novamente.');
    return work();
  });
  queues.set(name,operation);
  const cleanup=()=>{if(queues.get(name)===operation)queues.delete(name);};
  void operation.then(cleanup,cleanup);
  if(timeout<0)return operation;
  return Promise.race([operation,new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{expired=true;reject(new AuthLockTimeout('Aguarde a operação de autenticação em andamento e tente novamente.'));},timeout);
  })]);
}

type Auth = SupabaseClient['auth'];
const coordinationError=(error:unknown)=>error instanceof AuthError?error:new AuthError('A autenticação não foi confirmada. Aguarde e tente novamente.',503,'auth_coordination_failed');

export function coordinateAuthMethods(auth:Auth,storageKey:string,storage:SupportedStorage){
  const password=auth.signInWithPassword.bind(auth),getUser=auth.getUser.bind(auth);
  // Unlike verify/setSession/signOut, this SDK method does not acquire its lock.
  auth.signInWithPassword=async credentials=>{
    try{return await authSessionLock('lock:'+storageKey,AUTH_LOCK_TIMEOUT,()=>password(credentials));}
    catch(error){return {data:{user:null,session:null},error:coordinationError(error)};}
  };
  // Explicit-JWT reads bypass the SDK lock. A stale session_not_found response
  // can otherwise clear a newer session from shared storage.
  auth.getUser=async jwt=>{
    if(!jwt)return getUser();
    try{return await authSessionLock('lock:'+storageKey,AUTH_LOCK_TIMEOUT,async()=>{
      const raw=await storage.getItem(storageKey);
      const current=raw?JSON.parse(raw) as {access_token?:unknown}:null;
      if(current?.access_token!==jwt)throw new AuthError('A sessão mudou. Atualize a verificação.',409,'auth_session_changed');
      return getUser(jwt);
    });}catch(error){return {data:{user:null},error:coordinationError(error)};}
  };
}
