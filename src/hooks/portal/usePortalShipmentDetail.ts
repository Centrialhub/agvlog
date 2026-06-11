import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ShipmentDetail {
  document: Record<string, any>;
  load: Record<string, any> | null;
  trip: Record<string, any> | null;
  stop: Record<string, any> | null;
  events: any[];
  occurrences: any[];
  proofs: any[];
}

export function usePortalShipmentDetail(documentId?: string) {
  return useQuery({
    queryKey: ['portal_shipment_detail', documentId],
    queryFn: async (): Promise<ShipmentDetail> => {
      const { data, error } = await supabase.rpc('get_client_portal_shipment_detail', {
        _fiscal_document_id: documentId,
      });
      if (error) throw error;
      return data as unknown as ShipmentDetail;
    },
    enabled: !!documentId,
  });
}
