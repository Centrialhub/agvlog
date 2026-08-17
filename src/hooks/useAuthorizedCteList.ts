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
      // 1. Buscamos em fiscal_documents (saída) que foram autorizados
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

      // 2. Buscamos as emissões correspondentes para pegar o payload detalhado (e a chave se faltar)
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

      // 3. Buscamos TODOS os clientes do tenant para usar como fallback de endereço (CNPJ Match)
      const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('tax_id, address_street, address_number, address_neighborhood, address_city, address_state, address_zip, address_city_ibge_code, state_registration')
        .eq('tenant_id', currentTenant!.id);

      if (clientsError) throw clientsError;

      const clientMap = new Map<string, any>();
      for (const c of clients || []) {
        const k = (c.tax_id || '').replace(/\D+/g, '');
        if (k && !clientMap.has(k)) clientMap.set(k, c);
      }

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

      const documentEmissions = new Map<string, any>();
      for (const emission of emissions || []) {
        if (!emission.fiscal_document_id || documentEmissions.has(emission.fiscal_document_id)) continue;
        documentEmissions.set(emission.fiscal_document_id, emission);
      }

      return (outbound || []).map(d => {
        const emission = documentEmissions.get(d.id);
        const response = emission?.last_response as any;
        const payload = response?.payload || response?.document?.payload || {};
        
        // As partes no payload do Hub seguem a estrutura ide/emit/rem/dest ou no corpo dependendo da versão
        const remPart = payload.remetente || payload.rem || {};
        const remAddr = remPart.endereco || {};

        // Fallback para o cadastro do sistema (Match por CNPJ do remetente)
        const remCnpj = (d.remitter_cnpj || '').replace(/\D+/g, '');
        const client = clientMap.get(remCnpj);

        return {
          id: d.id,
          cte_number: d.invoice_number,
          access_key: d.access_key || accessKeys.get(d.id) || null,
          issued_at: d.issue_date,
          remitter: d.remitter,
          remitter_cnpj: d.remitter_cnpj,
          // IE: Payload -> Cadastro -> null
          remitter_ie: remPart.ie || client?.state_registration || null,
          // Endereço: Prioriza Payload do Hub, Fallback para Cadastro Local
          remitter_street: remAddr.logradouro || client?.address_street || null,
          remitter_number: remAddr.numero || client?.address_number || null,
          remitter_neighborhood: remAddr.bairro || client?.address_neighborhood || null,
          remitter_city: remAddr.municipio || client?.address_city || null,
          remitter_city_ibge: remAddr.cMun || remAddr.codigoMunicipio || client?.address_city_ibge_code || null,
          remitter_uf: remAddr.uf || client?.address_state || null,
          remitter_zip: remAddr.cep || remAddr.CEP || client?.address_zip || null,
          recipient: d.recipient,
          recipient_cnpj: d.recipient_cnpj,
          recipient_city: d.recipient_city,
          vehicle_plate: null,
          driver_name: null,
          hub_document_id: d.hub_document_id,
          cargo_value: d.value ? Number(d.value) : 0,
        };
      });
    }
  });
}
