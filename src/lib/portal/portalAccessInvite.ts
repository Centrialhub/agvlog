export type PortalPermissionKey =
  | 'can_view_financial'
  | 'can_download_documents'
  | 'can_open_occurrences'
  | 'can_request_pickup'
  | 'can_view_vehicle_live'
  | 'can_view_driver_contact';

export const PORTAL_PERMISSION_FIELDS: ReadonlyArray<readonly [PortalPermissionKey, string]> = [
  ['can_view_financial', 'Ver valores'],
  ['can_download_documents', 'Baixar documentos/canhotos'],
  ['can_open_occurrences', 'Abrir ocorrências'],
  ['can_request_pickup', 'Solicitar coleta'],
  ['can_view_vehicle_live', 'Ver veículo ao vivo'],
  ['can_view_driver_contact', 'Ver contato do motorista'],
];

export interface CreatePortalInviteResponse {
  success?: boolean;
  invited?: boolean;
  user_id?: string;
  email?: string | null;
  access_kind?: 'client_portal' | 'tenant_member';
  error?: string;
}

export const isPortalInviteEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
