import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import { useTenant } from './useTenant';
import { readAuthorizedCteHubDetails } from '@/lib/fiscal/ctePayload';

type ClientAddressFallback = Pick<
  Tables<'clients'>,
  'tax_id' | 'address_street' | 'address_number' | 'address_neighborhood' | 'address_city' |
  'address_state' | 'address_zip' | 'address_city_ibge_code' | 'state_registration'
>;

export interface AuthorizedCte {
  id: string;
  cte_number: string | null;
  access_key: string | null;
  issued_at: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_city_ibge: string | null;
  recipient_state: string | null;
  vehicle_id: string | null;
  vehicle_plate: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_cpf: string | null;
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
  cargo_weight: number | null;
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
          recipient_state,
          cte_driver_id,
          cte_vehicle_id,

          issue_date,
          value,
          weight_kg,
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
      let emissions: Array<{
        fiscal_document_id: string | null;
        access_key: string | null;
        last_response: Json | null;
        created_at: string;
      }> = [];
      if (documentIds.length) {
        const emissionResult = await supabase
          .from('hub_fiscal_emissions')
          .select('fiscal_document_id, access_key, last_response, created_at')
          .eq('tenant_id', currentTenant!.id)
          .eq('doc_type', 'cte')
          .in('fiscal_document_id', documentIds)
          .order('created_at', { ascending: false });
        if (emissionResult.error) throw emissionResult.error;
        emissions = emissionResult.data || [];
      }

      // 3. Buscamos TODOS os clientes do tenant para usar como fallback de endereço (CNPJ Match)
      const { data: clients, error: clientsError } = await supabase
        .from('clients')
        .select('tax_id, address_street, address_number, address_neighborhood, address_city, address_state, address_zip, address_city_ibge_code, state_registration')
        .eq('tenant_id', currentTenant!.id);

      if (clientsError) throw clientsError;

      const driverIds = Array.from(new Set(
        (outbound || []).map(document => document.cte_driver_id).filter((id): id is string => Boolean(id)),
      ));
      const driverMap = new Map<string, { id: string; name: string; cpf: string | null }>();
      if (driverIds.length) {
        const { data: drivers, error: driversError } = await supabase
          .from('drivers')
          .select('id, name, cpf')
          .eq('tenant_id', currentTenant!.id)
          .in('id', driverIds);
        if (driversError) throw driversError;
        for (const driver of drivers || []) driverMap.set(driver.id, driver);
      }

      const clientMap = new Map<string, ClientAddressFallback>();
      for (const c of clients || []) {
        const k = (c.tax_id || '').replace(/\D+/g, '');
        if (k && !clientMap.has(k)) clientMap.set(k, c);
      }

      const accessKeys = new Map<string, string>();
      for (const emission of emissions || []) {
        if (!emission.fiscal_document_id || accessKeys.has(emission.fiscal_document_id)) continue;
        const response = readAuthorizedCteHubDetails(emission.last_response);
        const key = emission.access_key
          || response.accessKey;
        if (/^\d{44}$/.test(String(key || ''))) {
          accessKeys.set(emission.fiscal_document_id, String(key));
        }
      }

      const documentEmissions = new Map<string, (typeof emissions)[number]>();
      for (const emission of emissions || []) {
        if (!emission.fiscal_document_id || documentEmissions.has(emission.fiscal_document_id)) continue;
        documentEmissions.set(emission.fiscal_document_id, emission);
      }

      return (outbound || []).map((d): AuthorizedCte => {
        const emission = documentEmissions.get(d.id);
        const hubDetails = readAuthorizedCteHubDetails(emission?.last_response);

        // Fallback para o cadastro do sistema (Match por CNPJ do remetente)
        const remCnpj = (d.remitter_cnpj || '').replace(/\D+/g, '');
        const client = clientMap.get(remCnpj);
        const recipientCnpj = (d.recipient_cnpj || '').replace(/\D+/g, '');
        const recipientClient = clientMap.get(recipientCnpj);
        const driver = d.cte_driver_id ? driverMap.get(d.cte_driver_id) : null;

        return {
          id: d.id,
          cte_number: d.invoice_number,
          access_key: d.access_key || accessKeys.get(d.id) || null,
          issued_at: d.issue_date,
          remitter: d.remitter,
          remitter_cnpj: d.remitter_cnpj,
          // IE: Payload -> Cadastro -> null
          remitter_ie: hubDetails.remitter.stateRegistration || client?.state_registration || null,
          // Endereço: Prioriza Payload do Hub, Fallback para Cadastro Local
          remitter_street: hubDetails.remitter.street || client?.address_street || null,
          remitter_number: hubDetails.remitter.number || client?.address_number || null,
          remitter_neighborhood: hubDetails.remitter.neighborhood || client?.address_neighborhood || null,
          remitter_city: hubDetails.remitter.city || client?.address_city || null,
          remitter_city_ibge: hubDetails.remitter.cityIbge || client?.address_city_ibge_code || null,
          remitter_uf: hubDetails.remitter.state || client?.address_state || null,
          remitter_zip: hubDetails.remitter.zip || client?.address_zip || null,
          recipient: d.recipient,
          recipient_cnpj: d.recipient_cnpj,
          recipient_city: d.recipient_city || recipientClient?.address_city || null,
          recipient_city_ibge: recipientClient?.address_city_ibge_code || null,
          recipient_state: d.recipient_state || recipientClient?.address_state || null,
          vehicle_id: d.cte_vehicle_id,
          vehicle_plate: null,
          driver_id: d.cte_driver_id,
          driver_name: driver?.name || null,
          driver_cpf: driver?.cpf || null,
          hub_document_id: d.hub_document_id,
          cargo_value: d.value ? Number(d.value) : 0,
          cargo_weight: d.weight_kg ? Number(d.weight_kg) : 0,
        };
      });
    }
  });
}
