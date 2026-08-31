import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {resetNotificationScope} from '@/lib/notificationScope';

export const MEMBERSHIP_QUERY = 'current-tenant-memberships';

// Remounted by tenant/actor/role, so even legacy queries and component drafts
// without explicit scope cannot be reused before the new screen is mounted.
export function TenantDataBoundary({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    client.removeQueries({ predicate: query => query.queryKey[0] !== MEMBERSHIP_QUERY });
    client.getMutationCache().clear();
    resetNotificationScope();
    setReady(true);
  }, [client]);
  return ready ? children : <p role="status">Atualizando contexto de acesso…</p>;
}
