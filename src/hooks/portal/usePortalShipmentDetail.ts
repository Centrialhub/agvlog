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

export interface ShipmentDetail {
  document: Record<string, any>;
  load: Record<string, any> | null;
  trip: Record<string, any> | null;
  stop: Record<string, any> | null;
  events?: any[];
  timeline?: TimelineEntry[];
  occurrences: any[];
  proofs: any[];
  permissions?: ShipmentPermissions;
}

export function usePortalShipmentDetail(documentId?: string) {
  return useQuery({
    queryKey: ['portal_shipment_detail_v2', documentId],
    queryFn: async (): Promise<ShipmentDetail> => {
      const v2 = await supabase.rpc('get_client_portal_shipment_detail_v2' as any, {
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
