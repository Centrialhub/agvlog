import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import type { PublicShipmentStatus } from '@/lib/portal/portalStatus';

export type TimelineEntryType = 'status' | 'event' | 'occurrence' | 'pod' | 'pickup' | 'document';

export interface TimelineEntry {
  id: string;
  type: TimelineEntryType;
  title: string;
  description?: string | null;
  occurred_at: string;
  severity?: 'info' | 'warning' | 'danger' | 'success';
  public_status?: PublicShipmentStatus | null;
}

export interface ShipmentPermissions {
  can_view_financial: boolean;
  can_download_documents: boolean;
  can_view_driver_contact: boolean;
  can_view_vehicle_live: boolean;
}

export interface ShipmentDocument {
  invoice_number?: string | null;
  public_status?: PublicShipmentStatus | null;
  status?: string | null;
  recipient?: string | null;
  recipient_city?: string | null;
  recipient_state?: string | null;
  document_type?: string | null;
  issue_date?: string | null;
  access_key?: string | null;
  client_load_number?: string | null;
  reference_number?: string | null;
  product_summary?: string | null;
  volume_count?: number | null;
  pallet_count?: number | null;
  weight_kg?: number | null;
  value?: number | null;
  freight_value?: number | null;
  remitter?: string | null;
  remitter_cnpj?: string | null;
  recipient_cnpj?: string | null;
  recipient_neighborhood?: string | null;
}

export interface ShipmentLoad {
  load_number?: string | null;
}

export interface ShipmentTrip {
  id?: string | null;
  vehicle_plate?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  status?: string | null;
  actual_start_at?: string | null;
}

export interface ShipmentStop {
  planned_arrival_at?: string | null;
  actual_arrival_at?: string | null;
}

export interface ShipmentOccurrence {
  id: string;
  event_type?: string | null;
  public_status?: string | null;
  created_at?: string | null;
  description?: string | null;
  client_action_required?: boolean | null;
  client_resolution_note?: string | null;
}

export interface ShipmentProof {
  id: string;
  version?: number;
  retired_at?: string | null;
  proof_type?: string | null;
  status?: string | null;
  has_file?: boolean | null;
  received_at?: string | null;
  receiver_name?: string | null;
}

export interface ShipmentDetail {
  context?: { tenant_id: string; actor_id: string; document_id: string };
  document: ShipmentDocument;
  load: ShipmentLoad | null;
  trip: ShipmentTrip | null;
  stop: ShipmentStop | null;
  events?: unknown[];
  timeline?: TimelineEntry[];
  occurrences: ShipmentOccurrence[];
  proofs: ShipmentProof[];
  proof_history?: ShipmentProof[];
  permissions?: ShipmentPermissions;
}

export function usePortalShipmentDetail(documentId?: string) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const actorId = user?.id; const tenantId = currentTenant?.id;
  return useQuery({
    queryKey: ['portal_shipment_detail_v2', tenantId, actorId, documentId],
    queryFn: async ({ signal }): Promise<ShipmentDetail> => {
      if (!documentId || !tenantId || !actorId) throw new Error('Selecione a empresa e entre com uma sessão válida.');
      const v2 = await supabase.rpc('get_client_portal_shipment_detail_v2', {
        _fiscal_document_id: documentId,
      }).abortSignal(signal);
      // Missing version may use the hardened legacy contract. A denial or
      // outage must never silently downgrade the authorization/read path.
      let result = v2;
      if (v2.error?.code === 'PGRST202') {
        result = await supabase.rpc('get_client_portal_shipment_detail', {
          _fiscal_document_id: documentId,
        }).abortSignal(signal);
      }
      if (result.error) throw result.error;
      const data = result.data as unknown as ShipmentDetail | null;
      const document = data?.document as ShipmentDocument & { id?: string } | undefined;
      if (!data || data.context?.tenant_id !== tenantId || data.context?.actor_id !== actorId
        || data.context?.document_id !== documentId || document?.id !== documentId
        || !Array.isArray(data.occurrences) || !Array.isArray(data.proofs)
        || data.proof_history !== undefined && !Array.isArray(data.proof_history)
        || data.timeline !== undefined && !Array.isArray(data.timeline)) {
        throw new Error('O servidor não confirmou o documento para esta sessão e empresa. Atualize seu acesso.');
      }
      return data;
    },
    enabled: !!documentId && !!tenantId && !!actorId,
    staleTime: 0,
    gcTime: 0,
  });
}
