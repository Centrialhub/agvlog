import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

export interface ShipmentRow {
  fiscal_document_id: string;
  invoice_number: string | null;
  access_key: string | null;
  document_type: string | null;
  document_status: string | null;
  client_load_number: string | null;
  reference_number: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  product_summary: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  issue_date: string | null;
  load_number: string | null;
  load_status: string | null;
  stop_status: string | null;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  has_pod: boolean;
  has_open_occurrence: boolean;
  public_status: string | null;
  updated_at: string;
}

export interface ShipmentFilters {
  search?: string;
  status?: string[];
  startDate?: string;
  endDate?: string;
  city?: string;
  state?: string;
  hasPod?: boolean;
  hasOccurrence?: boolean;
  limit?: number;
  offset?: number;
}

export function usePortalShipments(filters: ShipmentFilters = {}) {
  const { currentTenant } = useTenant();
  const scope = usePortalClientScope();

  const cnpjs = useMemo(() => {
    return scope.activeClients
      .map(c => c.client_tax_id)
      .filter((id): id is string => !!id);
  }, [scope.activeClients]);

  const clientIds = useMemo(() => {
    return scope.activeClients.map(c => c.client_id);
  }, [scope.activeClients]);

  return useQuery({
    queryKey: ['portal_shipments_v3', currentTenant?.id, scope.selectedClientId, clientIds, cnpjs, filters],
    queryFn: async (): Promise<{ rows: ShipmentRow[]; total: number }> => {
      if (!currentTenant || clientIds.length === 0) return { rows: [], total: 0 };
      
      const { data, error } = await (supabase as any).rpc('get_portal_tracking_v3', {
        p_tenant_id: currentTenant.id,
        p_client_ids: clientIds,
        p_cnpjs: cnpjs.length > 0 ? cnpjs : null,
        p_search: filters.search ?? null,
        p_limit: filters.limit ?? 50,
        p_offset: filters.offset ?? 0
      });

      if (error) throw error;
      
      const rows = (data as any[]) || [];
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      
      return { 
        rows: rows.map(r => ({
          fiscal_document_id: r.id,
          invoice_number: r.invoice_number,
          client_load_number: r.client_load_number,
          load_number: r.load_number,
          public_status: r.current_status,
          updated_at: r.last_event_at,
          value: r.total_value,
          remitter: r.remitter_name,
          recipient: r.recipient_name,
          recipient_city: r.recipient_city,
          recipient_state: r.recipient_state,
          issue_date: r.issue_date,
          planned_arrival_at: r.planned_arrival_at,
          pallet_count: r.pallet_count,
          has_pod: r.has_pod,
          has_open_occurrence: r.has_open_occurrence,
        })) as ShipmentRow[], 
        total 
      };
    },
    enabled: !!currentTenant && clientIds.length > 0,
  });
}
