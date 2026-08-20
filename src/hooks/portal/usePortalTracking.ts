import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

export interface PortalTrackingNextStop {
  id: string;
  sequence: number;
  destination: string | null;
  city: string | null;
  state: string | null;
  planned_arrival_at: string | null;
}

export interface PortalTrackingDocument {
  fiscal_document_id: string;
  invoice_number: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  public_status: string | null;
  planned_arrival_at: string | null;
  has_pod: boolean;
  has_open_occurrence: boolean;
}

export interface PortalTrackingItem {
  load_id: string;
  load_number: string;
  status: string;
  updated_at: string;
  client_id: string;
  trip_id: string | null;
  plate: string | null;
  vehicle_nickname: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  captured_at: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  actual_start_at: string | null;
  planned_end_at: string | null;
  next_stop: PortalTrackingNextStop | null;
  documents: PortalTrackingDocument[];
  can_view_vehicle_live: boolean;
  can_view_driver_contact: boolean;
}

export function usePortalTracking() {
  const { currentTenant } = useTenant();
  const scope = usePortalClientScope();
  
  // Collect all CNPJs from active clients to ensure broad scope
  const cnpjs = useMemo(() => {
    return scope.activeClients
      .map(c => c.client_tax_id)
      .filter((id): id is string => !!id);
  }, [scope.activeClients]);

  const clientIds = useMemo(() => {
    return scope.activeClients.map(c => c.client_id);
  }, [scope.activeClients]);

  return useQuery({
    queryKey: ['portal_tracking_v3', currentTenant?.id, scope.selectedClientId, clientIds, cnpjs],
    queryFn: async (): Promise<any[]> => {
      if (!currentTenant || clientIds.length === 0) return [];
      
      const { data, error } = await supabase.rpc('get_portal_tracking_v3', {
        p_tenant_id: currentTenant.id,
        p_client_ids: clientIds,
        p_cnpjs: cnpjs.length > 0 ? cnpjs : null,
      });

      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!currentTenant && clientIds.length > 0,
    refetchInterval: 60_000,
  });
}