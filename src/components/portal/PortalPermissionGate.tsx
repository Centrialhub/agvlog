import { ReactNode } from 'react';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

type Permission =
  | 'can_view_financial'
  | 'can_download_documents'
  | 'can_open_occurrences'
  | 'can_request_pickup'
  | 'can_view_vehicle_live'
  | 'can_view_driver_contact';

export function PortalPermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = usePortalClientScope();
  return <>{can(permission) ? children : fallback}</>;
}
