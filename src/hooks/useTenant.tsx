import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { MEMBERSHIP_QUERY, TenantDataBoundary } from '@/components/auth/TenantDataBoundary';
import { readTenantMembershipCache, readTenantMemberships, readTenantSelection, saveTenantMembershipCache, saveTenantSelection, type Membership } from '@/lib/tenantMemberships';
import {clearActiveTenantId,setActiveTenantId} from '@/lib/tenant/activeTenantContext';
import {supabase} from '@/integrations/supabase/client';

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

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, session, loading: authLoading } = useAuth();
  const online = useOnlineStatus();
  const actor = user?.id;
  const [selection, setSelection] = useState<{ actor: string; tenant: string } | null>(null);
  const [switchingTenant,setSwitchingTenant]=useState(false);
  const [tenantContextError,setTenantContextError]=useState<string|null>(null);
  const switchingTenantRef=useRef(false);
  const syncRevision=useRef(0);
  const queryClient=useQueryClient();
  const authClient=(supabase as typeof supabase&{auth?:typeof supabase.auth}).auth;
  const canRefreshTenantClaim=typeof authClient?.refreshSession==='function';
  const query = useQuery({
    queryKey: [MEMBERSHIP_QUERY, actor, online ? 'online' : 'offline'], enabled: !!actor && !authLoading,
    queryFn: async ({ signal }) => {
      if (!actor) return EMPTY_MEMBERSHIPS;
      if (!online) {
        const cached = readTenantMembershipCache(actor);
        if (!cached) throw new Error('Nenhum acesso validado está disponível offline.');
        return cached;
      }
      const fresh = await readTenantMemberships(signal);
      saveTenantMembershipCache(actor, fresh);
      return fresh;
    },
    retry: false, staleTime: 0, gcTime: 0,
  });
  const previousToken = useRef(session?.access_token);
  const { refetch } = query;
  useEffect(() => {
    if (previousToken.current !== session?.access_token) {
      previousToken.current = session?.access_token;
      if (actor) void refetch();
    }
  }, [actor, session?.access_token, refetch]);

  const memberships = actor && !query.isError ? query.data ?? EMPTY_MEMBERSHIPS : EMPTY_MEMBERSHIPS;
  const claimTenant=tokenTenant(session?.access_token);
  // The signed claim is authoritative across reloads and other tabs, but only
  // after the current membership read confirms that the actor still owns it.
  const preferred = memberships.some(m=>m.tenant_id===claimTenant)
    ? claimTenant
    : actor && selection?.actor === actor ? selection.tenant : actor ? readTenantSelection(actor) : null;
  const currentMembership = memberships.find(m => m.tenant_id === preferred) ?? memberships[0];
  const tenant = currentMembership?.tenant_id;
  useEffect(()=>{
    if(!actor||!tenant){switchingTenantRef.current=false;clearActiveTenantId();setSwitchingTenant(false);setTenantContextError(null);return;}
    // A TOKEN_REFRESHED event is emitted before an explicit tenant switch can
    // commit its React selection. Do not let this passive synchronizer restore
    // the previous tenant while that signed switch is still in flight.
    if(switchingTenantRef.current)return;
    const revision=++syncRevision.current;
    setActiveTenantId(tenant);
    saveTenantSelection(actor,tenant);
    if(tokenTenant(session?.access_token)===tenant||!online){switchingTenantRef.current=false;setSwitchingTenant(false);setTenantContextError(null);return()=>clearActiveTenantId(tenant);}
    const refresh=authClient?.refreshSession;
    if(typeof refresh!=='function'){switchingTenantRef.current=false;setSwitchingTenant(false);return()=>clearActiveTenantId(tenant);}
    switchingTenantRef.current=true;
    setSwitchingTenant(true);setTenantContextError(null);
    void (async()=>{
      const activation=await supabase.rpc('set_active_tenant_context_v1',{_tenant_id:tenant});
      if(activation.error)throw activation.error;
      const renewed=await refresh.call(authClient);
      if(renewed.error)throw renewed.error;
      if(tokenTenant(renewed.data.session?.access_token)!==tenant)throw new Error('active_tenant_claim_missing');
      if(syncRevision.current===revision){switchingTenantRef.current=false;setActiveTenantId(tenant);setSwitchingTenant(false);}
    })().catch(error=>{
      console.error('[useTenant] active tenant synchronization failed',error);
      if(syncRevision.current===revision){switchingTenantRef.current=false;clearActiveTenantId(tenant);setSwitchingTenant(false);setTenantContextError('Não foi possível confirmar a empresa ativa em todos os canais. Tente selecionar a empresa novamente.');}
    });
    return()=>clearActiveTenantId(tenant);
  },[actor,authClient,online,session?.access_token,tenant]);
  const activateTenantId = async (id: string):Promise<boolean> => {
    if (!actor || !memberships.some(m => m.tenant_id === id)) return false;
    if(id===tenant&&!tenantContextError&&!switchingTenantRef.current)return true;
    const previousTenant=tenant;
    const revision=++syncRevision.current;
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
    switchingTenantRef.current=true;
    setSwitchingTenant(true);
    await queryClient.cancelQueries();
    setActiveTenantId(id);
    const realtime=supabase as typeof supabase&{removeAllChannels?:()=>Promise<unknown>};
    void realtime.removeAllChannels?.();
    try{
      const activation=await supabase.rpc('set_active_tenant_context_v1',{_tenant_id:id});
      if(activation.error)throw activation.error;
       const refresh=authClient?.refreshSession;
       if(typeof refresh==='function'){
         const renewed=await refresh.call(authClient);
         if(renewed.error)throw renewed.error;
         if(tokenTenant(renewed.data.session?.access_token)!==id)throw new Error('active_tenant_claim_missing');
       }
       if(syncRevision.current===revision){
         switchingTenantRef.current=false;
         saveTenantSelection(actor,id);
         setSelection({actor,tenant:id});
         setSwitchingTenant(false);
       }
       return true;
    }catch(error){
      console.error('[useTenant] explicit tenant activation failed',error);
      if(syncRevision.current===revision){
        switchingTenantRef.current=false;
        if(previousTenant)setActiveTenantId(previousTenant);else clearActiveTenantId();
        setSwitchingTenant(false);
        setTenantContextError('Não foi possível trocar a empresa ativa. Tente novamente.');
      }
      return false;
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
        {actor && query.isError ? <div role="alert" className="p-6 space-y-3">
          <p>Não foi possível confirmar seus acessos. Os dados anteriores foram ocultados.</p>
          <button type="button" className="underline" disabled={query.isFetching} onClick={() => { void refetch(); }}>Tentar novamente</button>
        </div> : tenantContextError ? <div role="alert" className="m-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p>{tenantContextError}</p>
          {tenant?<button type="button" className="mt-2 underline" disabled={switchingTenant} onClick={()=>{void activateTenantId(tenant);}}>Tentar novamente</button>:null}
        </div> : switchingTenant||tenantSynchronizationRequired ? <div role="status" className="p-6">Confirmando empresa ativa…</div> : children}
      </TenantDataBoundary>
    </TenantContext.Provider>
  );
}
export function useTenant() { return useContext(TenantContext); }
export function useIsAdmin() { const { currentRole } = useTenant(); return currentRole === 'owner' || currentRole === 'admin'; }
