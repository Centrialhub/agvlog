import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface Tenant {
  id: string;
  name: string;
  plan_key: string;
  timezone: string;
}

interface Membership {
  tenant_id: string;
  role: 'owner' | 'admin' | 'operator' | 'client' | 'driver';
  tenants: Tenant;
}

interface TenantContextType {
  currentTenant: Tenant | null;
  currentRole: string | null;
  memberships: Membership[];
  setCurrentTenantId: (id: string) => void;
  loading: boolean;
}

const TenantContext = createContext<TenantContextType>({
  currentTenant: null,
  currentRole: null,
  memberships: [],
  setCurrentTenantId: () => {},
  loading: true,
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(
    localStorage.getItem('agvlog_tenant_id')
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMemberships = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('tenant_memberships')
          .select('tenant_id, role, tenants(id, name, plan_key, timezone)')
          .eq('user_id', user.id)
          .eq('active', true);

      if (!error && data) {
        let mapped = (data as any[]).map(d => ({
          tenant_id: d.tenant_id,
          role: d.role,
          tenants: d.tenants,
        }));

        // Portal-only users (no operational membership) may still belong to tenants
        // via client_portal_access. Surface those as virtual "client" memberships
        // so the portal layout works without an operational role.
        if (mapped.length === 0) {
          const { data: portalTenants } = await supabase.rpc('get_user_portal_tenants');
          if (Array.isArray(portalTenants) && portalTenants.length > 0) {
            mapped = (portalTenants as any[]).map((t) => ({
              tenant_id: t.id,
              role: 'client' as const,
              tenants: { id: t.id, name: t.name, plan_key: t.plan_key, timezone: t.timezone },
            }));
          }
        }

        setMemberships(mapped);

        // Selecionar tenant: prioriza o salvo se ainda é válido, senão pega o primeiro.
        const stored = localStorage.getItem('agvlog_tenant_id');
        const validStored = stored && mapped.some(m => m.tenant_id === stored) ? stored : null;
        if (validStored) {
          if (validStored !== currentTenantId) setCurrentTenantId(validStored);
        } else if (mapped.length > 0) {
          const firstId = mapped[0].tenant_id;
          setCurrentTenantId(firstId);
          localStorage.setItem('agvlog_tenant_id', firstId);
        } else {
          // Sem memberships: limpa seleção anterior.
          if (stored) localStorage.removeItem('agvlog_tenant_id');
          setCurrentTenantId(null);
        }
      }
        setLoading(false);
      } catch (err) {
        console.warn('[useTenant] fetchMemberships failed', err);
        setLoading(false);
      }
    };

    fetchMemberships();
    // Safety net so the app never hangs on a stuck backend.
    const timer = setTimeout(() => setLoading(false), 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchMemberships();
    });

    return () => {
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  const handleSetTenantId = (id: string) => {
    setCurrentTenantId(id);
    localStorage.setItem('agvlog_tenant_id', id);
  };

  const currentMembership = memberships.find(m => m.tenant_id === currentTenantId);

  return (
    <TenantContext.Provider value={{
      currentTenant: currentMembership?.tenants || null,
      currentRole: currentMembership?.role || null,
      memberships,
      setCurrentTenantId: handleSetTenantId,
      loading,
    }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}

export function useIsAdmin() {
  const { currentRole } = useTenant();
  return currentRole === 'owner' || currentRole === 'admin';
}
