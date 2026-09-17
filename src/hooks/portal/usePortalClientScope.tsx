import { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import { useClientPortalAccess, type PortalAccess } from './useClientPortalAccess';

type Permission =
  | 'can_view_financial'
  | 'can_download_documents'
  | 'can_open_occurrences'
  | 'can_request_pickup'
  | 'can_view_vehicle_live'
  | 'can_view_driver_contact';

interface ScopeContextValue {
  clients: PortalAccess[];
  selectedClientId: string | null; // null = todos
  setSelectedClientId: (id: string | null) => void;
  selectedClient: PortalAccess | null;
  activeClients: PortalAccess[]; // aplicando filtro atual
  can: (perm: Permission) => boolean;
  isLoading: boolean;
}

const Ctx = createContext<ScopeContextValue | undefined>(undefined);

export function PortalClientScopeProvider({ children }: { children: ReactNode }) {
  const { data: clients = [], isLoading } = useClientPortalAccess();
  const [requestedClientId, setRequestedClientId] = useState<string | null>(null);

  const value = useMemo<ScopeContextValue>(() => {
    const selectedClientId = clients.length === 1
      ? clients[0].client_id
      : requestedClientId && clients.some((client) => client.client_id === requestedClientId)
        ? requestedClientId
        : null;
    const selectedClient = selectedClientId
      ? clients.find((c) => c.client_id === selectedClientId) ?? null
      : null;
    const activeClients = selectedClient ? [selectedClient] : clients;
    const can = (perm: Permission) => activeClients.some((c) => Boolean(c[perm]));
    const setSelectedClientId = (id: string | null) => {
      setRequestedClientId(id && clients.some((client) => client.client_id === id) ? id : null);
    };
    return {
      clients,
      selectedClientId,
      setSelectedClientId,
      selectedClient,
      activeClients,
      can,
      isLoading,
    };
  }, [clients, requestedClientId, isLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortalClientScope() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortalClientScope must be used inside PortalClientScopeProvider');
  return ctx;
}
