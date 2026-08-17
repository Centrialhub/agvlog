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
  cargo_value: number | null;
  remitter_cnpj: string | null;
  remitter_ie: string | null;
  remitter_street: string | null;
  remitter_number: string | null;
  remitter_neighborhood: string | null;
  remitter_city: string | null;
  remitter_city_ibge: string | null;
  remitter_uf: string | null;
  remitter_zip: string | null;
  recipient_cnpj: string | null;
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
          remitter_cnpj,
          remitter_ie,
          remitter_street,
          remitter_number,
          remitter_neighborhood,
          remitter_city,
          remitter_city_ibge,
          remitter_uf,
          remitter_zip,
          recipient, 
          recipient_cnpj,
          recipient_city, 

          issue_date,
          value,
          hub_document_id
        `)
        .eq('tenant_id', currentTenant!.id)
        .is('deleted_at', null)
        .eq('document_type', 'outbound')
        .eq('status', 'authorized')
        .order('issue_date', { ascending: false })
        .limit(100);

      if (error) throw error;

      const documentIds = (outbound || []).map(document => document.id);
      const { data: emissions, error: emissionsError } = documentIds.length
        ? await supabase
            .from('hub_fiscal_emissions')
            .select('fiscal_document_id, access_key, last_response, created_at')
            .eq('tenant_id', currentTenant!.id)
            .eq('doc_type', 'cte')
            .in('fiscal_document_id', documentIds)
            .order('created_at', { ascending: false })
        : { data: [], error: null };

      if (emissionsError) throw emissionsError;

      const accessKeys = new Map<string, string>();
      for (const emission of emissions || []) {
        if (!emission.fiscal_document_id || accessKeys.has(emission.fiscal_document_id)) continue;
        const response = emission.last_response as any;
        const key = emission.access_key
          || response?.document?.access_key
          || response?.document?.accessKey;
        if (/^\d{44}$/.test(String(key || ''))) {
          accessKeys.set(emission.fiscal_document_id, String(key));
        }
      }

      return (outbound || []).map(d => ({
        id: d.id,
        cte_number: d.invoice_number,
        access_key: d.access_key || accessKeys.get(d.id) || null,
        issued_at: d.issue_date,
        remitter: d.remitter,
        recipient: d.recipient,
        recipient_city: d.recipient_city,
        vehicle_plate: null, // fiscal_documents não tem placa direto, precisaríamos de join se fosse vital agora
        driver_name: null,
        hub_document_id: d.hub_document_id,
        cargo_value: d.value ? Number(d.value) : 0,
        remitter_cnpj: (d as any).remitter_cnpj,
        recipient_cnpj: (d as any).recipient_cnpj
      }));
    }
  });
}
