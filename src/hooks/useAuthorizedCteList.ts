import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export interface AuthorizedCte {
  id: string;
  cte_number: string | null;
  access_key: string | null;
  issued_at: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  vehicle_plate: string | null;
  driver_name: string | null;
  hub_document_id: string | null;
}

export function useAuthorizedCteList() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['authorized_ctes', currentTenant?.id],
    enabled: !!currentTenant,
    queryFn: async (): Promise<AuthorizedCte[]> => {
      // Buscamos em fiscal_documents (saída) que foram autorizados
      const { data: outbound, error } = await supabase
        .from('fiscal_documents')
        .select(`
          id, 
          invoice_number, 
          access_key, 
          status, 
          sefaz_status,
          remitter, 
          recipient, 
          recipient_city, 
          issue_date,
          hub_document_id
        `)
        .eq('tenant_id', currentTenant!.id)
        .eq('document_type', 'outbound')
        .eq('status', 'authorized')
        .order('issue_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      return (outbound || []).map(d => ({
        id: d.id,
        cte_number: d.invoice_number,
        access_key: d.access_key,
        issued_at: d.issue_date,
        remitter: d.remitter,
        recipient: d.recipient,
        recipient_city: d.recipient_city,
        vehicle_plate: null, // fiscal_documents não tem placa direto, precisaríamos de join se fosse vital agora
        driver_name: null,
        hub_document_id: d.hub_document_id
      }));
    }
  });
}
