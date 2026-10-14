import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { MEMBERSHIP_QUERY, TenantDataBoundary } from '@/components/auth/TenantDataBoundary';
import { readTenantMembershipCache, readTenantMemberships, readTenantSelection, saveTenantMembershipCache, saveTenantSelection, isMembershipTransportFailure, type Membership } from '@/lib/tenantMemberships';
import { commitConfirmedDriverContext, readMembershipsWithConfirmedDriverContext, useConfirmedDriverFallback, type ConfirmedDriverContext } from '@/lib/tenant/offlineConfirmedTenantContext';
import {clearActiveTenantId,setActiveTenantId} from '@/lib/tenant/activeTenantContext';
import {supabase} from '@/integrations/supabase/client';
import { isExpiredSessionError } from '@/lib/errors';
import {createTenantActivationAttempt,type TenantActivationAttempt} from '@/lib/tenant/tenantActivationAttempt';

interface TenantContextType {
  currentTenant: Membership['tenants'] | null;
  currentRole: string | null;
  memberships: Membership[];
  setCurrentTenantId: (id: string) => void;
  activateTenantId: (id: string) => Promise<boolean>;
  loading: boolean;
  switchingTenant: boolean;
  tenantContextError: string | null;
}
const TenantContext = createContext<TenantContextType>({
  currentTenant: null, currentRole: null, memberships: [], setCurrentTenantId: () => {}, activateTenantId: async () => false, loading: true,
  switchingTenant: false, tenantContextError: null,
});
const EMPTY_MEMBERSHIPS: Membership[] = [];

function tokenTenant(accessToken:string|undefined){
  if(!accessToken)return null;
  try{
    const encoded=accessToken.split('.')[1];
    if(!encoded)return null;
    const normalized=encoded.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(encoded.length/4)*4,'=');
    return (JSON.parse(atob(normalized)) as {active_tenant_id?:unknown}).active_tenant_id as string||null;
  }catch{return null;}
}

function tenantActivationErrorMessage(error:unknown){
  return isExpiredSessionError(error)
    ? 'Sua sessão expirou. Saia e entre novamente para trocar de empresa.'
    : 'Não foi possível trocar a empresa ativa. Tente novamente.';
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, session, loading: authLoading, signOut } = useAuth();
  const online = useOnlineStatus();
  const actor = user?.id;
  const confirmedFallback=useConfirmedDriverFallback(actor,session);
  const membershipIdentity=useRef({actor,session});membershipIdentity.current={actor,session};
  const stagedDriverContext=useRef<ConfirmedDriverContext|null>(null);
  const [selection, setSelection] = useState<{ actor: string; tenant: string } | null>(null);
  const [switchingTenant,setSwitchingTenant]=useState(false);
  const [tenantContextError,setTenantContextError]=useState<string|null>(null);
  const switchingTenantRef=useRef(false);
  const pendingActivation=useRef<{actor:string;id:string;role:Membership['role'];revision:number}|null>(null);
  const syncRevision=useRef(0);
  const mounted=useRef(false);
  const activeAttempt=useRef<TenantActivationAttempt|null>(null);
  // A late SDK refresh may publish a valid token after cancellation. Recovery
  // remains explicit for this actor; a token event alone must not open the app.
  const blockedActor=useRef<string|null>(null);
  const invalidateActivation=useCallback(()=>{
    mounted.current=false;++syncRevision.current;activeAttempt.current?.cancel('superseded');
  },[]);
  useEffect(()=>{mounted.current=true;blockedActor.current=null;return invalidateActivation;},[actor,invalidateActivation]);
  const queryClient=useQueryClient();
  const authClient=(supabase as typeof supabase&{auth?:typeof supabase.auth}).auth;
  const canRefreshTenantClaim=typeof authClient?.refreshSession==='function';
  const query = useQuery({
    // Connectivity changes revalidate the same actor rather than replacing its
    // confirmed scope and unmounting in-progress plans. Offline reads are local.
    queryKey: [MEMBERSHIP_QUERY, actor], enabled: !!actor && !authLoading,
    networkMode: 'always', refetchOnReconnect: false,
    queryFn: ({signal}) => readMembershipsWithConfirmedDriverContext({
      actor,session,online,signal,currentIdentity:()=>membershipIdentity.current,
      readFresh:readTenantMemberships,readOffline:readTenantMembershipCache,saveFresh:saveTenantMembershipCache,
      isTransportFailure:isMembershipTransportFailure,reportFallback:confirmedFallback.report,stage:value=>{stagedDriverContext.current=value;},
    }),
    retry: false, staleTime: 0, gcTime: 0,
  });
  const previousToken = useRef(session?.access_token);
  const previousOnline = useRef(online);
  const { refetch } = query;
  useEffect(() => {
    const changed=previousToken.current!==session?.access_token||previousOnline.current!==online;
    previousToken.current=session?.access_token;previousOnline.current=online;
    if(actor&&!authLoading&&changed)void refetch();
  }, [actor, authLoading, online, session?.access_token, refetch]);

  const memberships = actor && !query.isError && confirmedFallback.valid ? query.data ?? EMPTY_MEMBERSHIPS : EMPTY_MEMBERSHIPS;
  const claimTenant=tokenTenant(session?.access_token);
  // The signed claim is authoritative across reloads and other tabs, but only
  // after the current membership read confirms that the actor still owns it.
  const preferred = memberships.some(m=>m.tenant_id===claimTenant)
    ? claimTenant
    : actor && selection?.actor === actor ? selection.tenant : actor ? readTenantSelection(actor) : null;
  const currentMembership = memberships.find(m => m.tenant_id === preferred) ?? memberships[0];
  const tenant = currentMembership?.tenant_id;
  const role=currentMembership?.role;
  useEffect(()=>{
    if(!online||switchingTenant||switchingTenantRef.current||tenantContextError||blockedActor.current===actor||pendingActivation.current)return;
    commitConfirmedDriverContext(stagedDriverContext.current,actor,session,{tenant,role});
  },[actor,online,session,tenant,role,query.dataUpdatedAt,switchingTenant,tenantContextError]);
  const identity=useRef({actor,tenant,role});identity.current={actor,tenant,role};
  const beginAttempt=useCallback((revision:number,ownsContext:()=>boolean)=>{
    activeAttempt.current?.cancel('superseded');
    const attempt=createTenantActivationAttempt(reason=>{
      if(reason==='superseded'||!ownsContext())return;
      blockedActor.current=actor??null;
      ++syncRevision.current;
      if(pendingActivation.current?.revision===revision)pendingActivation.current=null;
      switchingTenantRef.current=false;clearActiveTenantId();setSwitchingTenant(false);
      setTenantContextError(reason==='timeout'
        ? 'A confirmação da empresa demorou mais que o esperado. O acesso continua bloqueado. Tente novamente ou saia da conta.'
        : 'A confirmação da empresa foi cancelada. Tente novamente ou saia da conta.');
    });
    activeAttempt.current=attempt;
    return attempt;
  },[actor]);
  const finishAttempt=useCallback((attempt:TenantActivationAttempt)=>{
    attempt.finish();if(activeAttempt.current===attempt)activeAttempt.current=null;
  },[]);
  const exitTenantActivation=()=>{activeAttempt.current?.cancel('cancelled');void signOut();};
  const previousContext=useRef({tenant,role});
  useEffect(()=>{
    const target=pendingActivation.current;
    // The signed target may have a different role from the source company.
    // Only this confirmed target transition belongs to the pending switch.
    const completingSwitch=switchingTenantRef.current&&target?.revision===syncRevision.current&&target.actor===actor&&target.id===tenant&&target.role===role;
    if((previousContext.current.tenant!==tenant||previousContext.current.role!==role)&&!completingSwitch){
      ++syncRevision.current;activeAttempt.current?.cancel('superseded');switchingTenantRef.current=false;setSwitchingTenant(false);
      if(blockedActor.current!==actor)setTenantContextError(null);
    }
    previousContext.current={tenant,role};
  },[actor,role,tenant]);
  useEffect(()=>{
    if(!actor||!tenant){activeAttempt.current?.cancel('superseded');switchingTenantRef.current=false;clearActiveTenantId();setSwitchingTenant(false);if(!actor||blockedActor.current!==actor)setTenantContextError(null);return;}
    if(blockedActor.current===actor)return;
    // A TOKEN_REFRESHED event is emitted before an explicit tenant switch can
    // commit its React selection. Do not let this passive synchronizer restore
    // the previous tenant while that signed switch is still in flight.
    if(switchingTenantRef.current)return;
    const revision=++syncRevision.current;
    let alive=true;
    let attempt:TenantActivationAttempt|null=null;
    const ownsContext=()=>alive&&mounted.current&&syncRevision.current===revision&&identity.current.actor===actor&&identity.current.tenant===tenant&&identity.current.role===role;
    const current=()=>ownsContext()&&!attempt?.stopped;
    const release=()=>{
      alive=false;attempt?.cancel('superseded');
      if(syncRevision.current===revision)switchingTenantRef.current=false;
      // A replaced effect must not clear the newer attempt's confirmed header.
      if(!mounted.current||syncRevision.current===revision)clearActiveTenantId(tenant);
    };
    setActiveTenantId(tenant);
    saveTenantSelection(actor,tenant);
    if(tokenTenant(session?.access_token)===tenant||!online){switchingTenantRef.current=false;setSwitchingTenant(false);setTenantContextError(null);return release;}
    const refresh=authClient?.refreshSession;
    if(typeof refresh!=='function'){switchingTenantRef.current=false;setSwitchingTenant(false);return release;}
    switchingTenantRef.current=true;
    setSwitchingTenant(true);setTenantContextError(null);
    const passiveAttempt=beginAttempt(revision,ownsContext);attempt=passiveAttempt;
    void (async()=>{
      const activation=await passiveAttempt.wait(supabase.rpc('set_active_tenant_context_v1',{_tenant_id:tenant}));
      if(!current())return;
      if(activation.error)throw activation.error;
      const renewed=await passiveAttempt.wait(refresh.call(authClient));
      if(!current())return;
      if(renewed.error)throw renewed.error;
      if(tokenTenant(renewed.data.session?.access_token)!==tenant)throw new Error('active_tenant_claim_missing');
      if(current()){switchingTenantRef.current=false;setActiveTenantId(tenant);setSwitchingTenant(false);}
    })().catch(error=>{
      console.error('[useTenant] active tenant synchronization failed',error);
      if(current()){switchingTenantRef.current=false;clearActiveTenantId(tenant);setSwitchingTenant(false);setTenantContextError('Não foi possível confirmar a empresa ativa em todos os canais. Tente selecionar a empresa novamente.');}
    }).finally(()=>finishAttempt(passiveAttempt));
    return release;
  },[actor,authClient,online,session?.access_token,tenant,role,beginAttempt,finishAttempt]);
  const activateTenantId = async (id: string):Promise<boolean> => {
    const target=memberships.find(m=>m.tenant_id===id);
    if (!actor || !target) return false;
    if(id===tenant&&!tenantContextError&&!switchingTenantRef.current&&blockedActor.current!==actor)return true;
    const previousTenant=tenant;
    const revision=++syncRevision.current;
    let attempt:TenantActivationAttempt|null=null;
    const ownsContext=()=>mounted.current&&syncRevision.current===revision&&identity.current.actor===actor&&((identity.current.tenant===previousTenant&&identity.current.role===role)||(identity.current.tenant===id&&identity.current.role===target.role));
    const current=()=>ownsContext()&&!attempt?.stopped;
    activeAttempt.current?.cancel('superseded');blockedActor.current=null;
    setTenantContextError(null);
    if(!online){
      switchingTenantRef.current=false;
      setActiveTenantId(id);saveTenantSelection(actor,id);setSelection({actor,tenant:id});setSwitchingTenant(false);return true;
    }
    // Compatibility for isolated/test clients that do not expose Supabase
    // Auth. The production client always takes the signed-claim path below.
    if(!canRefreshTenantClaim){
      switchingTenantRef.current=false;
      setActiveTenantId(id);saveTenantSelection(actor,id);setSelection({actor,tenant:id});setSwitchingTenant(false);return true;
    }
    pendingActivation.current={actor,id,role:target.role,revision};
    switchingTenantRef.current=true;
    setSwitchingTenant(true);
    const realtime=supabase as typeof supabase&{removeAllChannels?:()=>Promise<unknown>};
    let activationCommitted=false;
    attempt=beginAttempt(revision,ownsContext);
    try{
      // Validate that this browser can still rotate its token before changing
      // the durable tenant context. An expired refresh token must not leave the
      // next login pointing at a company that this UI never finished opening.
      const refresh=authClient?.refreshSession;
      if(typeof refresh==='function'){
        const validated=await attempt.wait(refresh.call(authClient));
        if(!current())return false;
        if(validated.error)throw validated.error;
      }
      if(!current())return false;
      await attempt.wait(queryClient.cancelQueries());
      if(!current())return false;
      setActiveTenantId(id);
      void realtime.removeAllChannels?.();
      const activation=await attempt.wait(supabase.rpc('set_active_tenant_context_v1',{_tenant_id:id}));
      if(!current())return false;
      if(activation.error)throw activation.error;
       activationCommitted=true;
       if(typeof refresh==='function'){
         const renewed=await attempt.wait(refresh.call(authClient));
         if(!current())return false;
         if(renewed.error)throw renewed.error;
         if(tokenTenant(renewed.data.session?.access_token)!==id)throw new Error('active_tenant_claim_missing');
       }
       if(current()){
         switchingTenantRef.current=false;setActiveTenantId(id);
         saveTenantSelection(actor,id);
         setSelection({actor,tenant:id});
         setSwitchingTenant(false);
       }
       return current();
    }catch(error){
      console.error('[useTenant] explicit tenant activation failed',error);
      if(!current())return false;
      if(activationCommitted&&previousTenant){
        setActiveTenantId(previousTenant);
        try{
          const rollback=await attempt.wait(supabase.rpc('set_active_tenant_context_v1',{_tenant_id:previousTenant}));
          if(!current())return false;
          if(rollback.error)console.error('[useTenant] tenant activation rollback failed',rollback.error);
        }catch(rollbackError){
          if(!current())return false;
          console.error('[useTenant] tenant activation rollback failed',rollbackError);
        }
      }
      if(current()){
        switchingTenantRef.current=false;
        if(previousTenant)setActiveTenantId(previousTenant);else clearActiveTenantId();
        setSwitchingTenant(false);
        setTenantContextError(tenantActivationErrorMessage(error));
      }
      return false;
    }finally{
      finishAttempt(attempt);
      if(pendingActivation.current?.revision===revision)pendingActivation.current=null;
    }
  };
  const handleSetTenantId = (id: string) => { void activateTenantId(id); };
  const loading = authLoading || (!!actor && query.isPending);
  const tenantSynchronizationRequired=Boolean(online&&actor&&tenant&&canRefreshTenantClaim&&claimTenant!==tenant);
  const scope = [actor ?? '', tenant ?? '', currentMembership?.role ?? ''].join(':');
  return (
    <TenantContext.Provider value={{
      currentTenant: currentMembership?.tenants ?? null, currentRole: currentMembership?.role ?? null,
      memberships, setCurrentTenantId: handleSetTenantId, activateTenantId, loading, switchingTenant, tenantContextError,
    }}>
      <TenantDataBoundary key={scope}>
        {actor && (query.isError||!confirmedFallback.valid) ? <div role="alert" className="p-6 space-y-3">
          <p>Não foi possível confirmar seus acessos. Os dados anteriores foram ocultados.</p>
          <button type="button" className="underline" disabled={query.isFetching} onClick={() => { void refetch(); }}>Tentar novamente</button>
        </div> : tenantContextError ? <div role="alert" className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{tenantContextError}</p>
          {isExpiredSessionError({message:tenantContextError})
            ? <button type="button" className="mt-2 underline" onClick={exitTenantActivation}>Entrar novamente</button>
            : tenant?<button type="button" className="mt-2 underline" disabled={switchingTenant} onClick={()=>{void activateTenantId(tenant);}}>Tentar novamente</button>:null}
          {!isExpiredSessionError({message:tenantContextError})&&<button type="button" className="ml-4 mt-2 underline" onClick={exitTenantActivation}>Sair</button>}
        </div> : switchingTenant||tenantSynchronizationRequired ? <div role="status" className="p-6">
          <p>Confirmando empresa ativa.</p>
          <button type="button" className="mt-2 underline" onClick={()=>activeAttempt.current?.cancel('cancelled')}>Cancelar</button>
          <button type="button" className="ml-4 mt-2 underline" onClick={exitTenantActivation}>Sair</button>
        </div> : children}
      </TenantDataBoundary>
    </TenantContext.Provider>
  );
}
export function useTenant() { return useContext(TenantContext); }
export function useIsAdmin() { const { currentRole } = useTenant(); return currentRole === 'owner' || currentRole === 'admin'; }
