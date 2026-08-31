import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { MEMBERSHIP_QUERY, TenantDataBoundary } from '@/components/auth/TenantDataBoundary';
import { readTenantMemberships, readTenantSelection, saveTenantSelection, type Membership } from '@/lib/tenantMemberships';

interface TenantContextType {
  currentTenant: Membership['tenants'] | null;
  currentRole: string | null;
  memberships: Membership[];
  setCurrentTenantId: (id: string) => void;
  loading: boolean;
}
const TenantContext = createContext<TenantContextType>({
  currentTenant: null, currentRole: null, memberships: [], setCurrentTenantId: () => {}, loading: true,
});
const EMPTY_MEMBERSHIPS: Membership[] = [];

export function TenantProvider({ children }: { children: ReactNode }) {
  const { user, session, loading: authLoading } = useAuth();
  const actor = user?.id;
  const [selection, setSelection] = useState<{ actor: string; tenant: string } | null>(null);
  const query = useQuery({
    queryKey: [MEMBERSHIP_QUERY, actor], enabled: !!actor && !authLoading,
    queryFn: ({ signal }) => readTenantMemberships(signal),
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
  const preferred = actor && selection?.actor === actor ? selection.tenant : actor ? readTenantSelection(actor) : null;
  const currentMembership = memberships.find(m => m.tenant_id === preferred) ?? memberships[0];
  const tenant = currentMembership?.tenant_id;
  useEffect(() => { if (actor && tenant) saveTenantSelection(actor, tenant); }, [actor, tenant]);
  const handleSetTenantId = (id: string) => {
    if (!actor || !memberships.some(m => m.tenant_id === id)) return;
    saveTenantSelection(actor, id);
    setSelection({ actor, tenant: id });
  };
  const loading = authLoading || (!!actor && query.isPending);
  const scope = [actor ?? '', tenant ?? '', currentMembership?.role ?? ''].join(':');
  return (
    <TenantContext.Provider value={{
      currentTenant: currentMembership?.tenants ?? null, currentRole: currentMembership?.role ?? null,
      memberships, setCurrentTenantId: handleSetTenantId, loading,
    }}>
      <TenantDataBoundary key={scope}>
        {actor && query.isError ? <div role="alert" className="p-6 space-y-3">
          <p>Não foi possível confirmar seus acessos. Os dados anteriores foram ocultados.</p>
          <button type="button" className="underline" disabled={query.isFetching} onClick={() => { void refetch(); }}>Tentar novamente</button>
        </div> : children}
      </TenantDataBoundary>
    </TenantContext.Provider>
  );
}
export function useTenant() { return useContext(TenantContext); }
export function useIsAdmin() { const { currentRole } = useTenant(); return currentRole === 'owner' || currentRole === 'admin'; }
