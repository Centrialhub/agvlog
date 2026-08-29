import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
  proof_type?: string | null;
  status?: string | null;
  has_file?: boolean | null;
  received_at?: string | null;
  receiver_name?: string | null;
}

export interface ShipmentDetail {
  document: ShipmentDocument;
  load: ShipmentLoad | null;
  trip: ShipmentTrip | null;
  stop: ShipmentStop | null;
  events?: unknown[];
  timeline?: TimelineEntry[];
  occurrences: ShipmentOccurrence[];
  proofs: ShipmentProof[];
  permissions?: ShipmentPermissions;
}

export function usePortalShipmentDetail(documentId?: string) {
  return useQuery({
    queryKey: ['portal_shipment_detail_v2', documentId],
    queryFn: async (): Promise<ShipmentDetail> => {
      if (!documentId) throw new Error('Documento não selecionado');
      const v2 = await supabase.rpc('get_client_portal_shipment_detail_v2', {
        _fiscal_document_id: documentId,
      });
      if (!v2.error && v2.data) return v2.data as unknown as ShipmentDetail;
      const { data, error } = await supabase.rpc('get_client_portal_shipment_detail', {
        _fiscal_document_id: documentId,
      });
      if (error) throw error;
      return data as unknown as ShipmentDetail;
    },
    enabled: !!documentId,
  });
}
