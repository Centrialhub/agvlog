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
  role: 'owner' | 'admin' | 'operator' | 'client';
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
        const mapped = (data as any[]).map(d => ({
          tenant_id: d.tenant_id,
          role: d.role,
          tenants: d.tenants,
        }));
        setMemberships(mapped);

        if (mapped.length > 0 && !currentTenantId) {
          const firstId = mapped[0].tenant_id;
          setCurrentTenantId(firstId);
          localStorage.setItem('agvlog_tenant_id', firstId);
        }
      }
      setLoading(false);
    };

    fetchMemberships();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchMemberships();
    });

    return () => subscription.unsubscribe();
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
