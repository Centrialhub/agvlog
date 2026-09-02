import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import { useTenant } from './useTenant';
import { readAuthorizedCteHubDetails, readCteMdfeDetails, type CteTakerRole } from '@/lib/fiscal/ctePayload';
import {
  deriveMdfePredominantProduct,
  groupLinkedNfeProducts,
  type FiscalSourceReservationLink,
  type LinkedNfeSourceRow,
  type MdfeLinkedNfeProduct,
} from '@/lib/fiscal/mdfePredominantProduct';

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
  predominant_product: string | null;
  linked_nfe_products: MdfeLinkedNfeProduct[];
  taker_role: CteTakerRole | null;
  taker_name: string | null;
  taker_document: string | null;
  taker_ie: string | null;
  taker_street: string | null;
  taker_number: string | null;
  taker_neighborhood: string | null;
  taker_city: string | null;
  taker_city_ibge: string | null;
  taker_state: string | null;
  taker_zip: string | null;
  insurance_endorsements: string[];
  load_ids: string[];
}

export function useAuthorizedCteList(loadId?: string | null) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['authorized_ctes', currentTenant?.id, loadId || 'recent'],
    enabled: !!currentTenant,
    queryFn: async (): Promise<AuthorizedCte[]> => {
      // Para emissão por carga, resolvemos primeiro o catálogo canônico da carga.
      // Isso evita perder CT-es antigos por causa do limite da consulta geral.
      let scopedDocumentIds: string[] | null = null;
      if (loadId) {
        const { data: links, error: linksError } = await supabase
          .from('cte_documents')
          .select('id')
          .eq('tenant_id', currentTenant!.id)
          .contains('load_ids', [loadId]);
        if (linksError) throw linksError;
        scopedDocumentIds = (links || []).map(link => link.id);
        if (!scopedDocumentIds.length) return [];
      }

      // 1. Buscamos em fiscal_documents (saída) que foram autorizados
      let outboundQuery = supabase
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
          cte_payload,
          cte_taker_role,
          insurer_endorsement,
          insured_amount,

          issue_date,
          weight_kg,
          hub_document_id
        `)
        .eq('tenant_id', currentTenant!.id)
        .is('deleted_at', null)
        .eq('document_type', 'outbound')
        .eq('status', 'authorized')
        .order('issue_date', { ascending: false });
      outboundQuery = scopedDocumentIds
        ? outboundQuery.in('id', scopedDocumentIds)
        : outboundQuery.limit(100);
      const { data: outbound, error } = await outboundQuery;

      if (error) throw error;

      // 2. Buscamos as emissões correspondentes para pegar o payload detalhado (e a chave se faltar)
      const documentIds = (outbound || []).map(document => document.id);
      let emissions: Array<{
        fiscal_document_id: string | null;
        access_key: string | null;
        last_response: Json | null;
        created_at: string;
      }> = [];
      const loadIdsByCte = new Map<string, string[]>();
      if (documentIds.length) {
        const [emissionResult, cteLinksResult] = await Promise.all([
          supabase
            .from('hub_fiscal_emissions')
            .select('fiscal_document_id, access_key, last_response, created_at')
            .eq('tenant_id', currentTenant!.id)
            .eq('doc_type', 'cte')
            .in('fiscal_document_id', documentIds)
            .order('created_at', { ascending: false }),
          supabase
            .from('cte_documents')
            .select('id, load_ids')
            .eq('tenant_id', currentTenant!.id)
            .in('id', documentIds),
        ]);
        if (emissionResult.error) throw emissionResult.error;
        if (cteLinksResult.error) throw cteLinksResult.error;
        emissions = emissionResult.data || [];
        for (const row of cteLinksResult.data || []) loadIdsByCte.set(row.id, row.load_ids || []);
      }

      let reservations: FiscalSourceReservationLink[] = [];
      const sourceDocuments: LinkedNfeSourceRow[] = [];
      if (documentIds.length) {
        const reservationResult = await supabase
          .from('fiscal_source_reservations')
          .select('source_id, outbound_id')
          .eq('tenant_id', currentTenant!.id)
          .in('outbound_id', documentIds);
        if (reservationResult.error) throw reservationResult.error;
        reservations = reservationResult.data || [];

        const sourceIds = [...new Set(reservations.map(row => row.source_id))];
        if (sourceIds.length) {
          const reservedSourceResult = await supabase
            .from('fiscal_documents')
            .select('id, cte_emitted_outbound_id, product_summary, value, weight_kg')
            .eq('tenant_id', currentTenant!.id)
            .eq('document_type', 'inbound')
            .is('deleted_at', null)
            .in('id', sourceIds);
          if (reservedSourceResult.error) throw reservedSourceResult.error;
          sourceDocuments.push(...(reservedSourceResult.data || []));
        }

        const legacySourceResult = await supabase
          .from('fiscal_documents')
          .select('id, cte_emitted_outbound_id, product_summary, value, weight_kg')
          .eq('tenant_id', currentTenant!.id)
          .eq('document_type', 'inbound')
          .is('deleted_at', null)
          .in('cte_emitted_outbound_id', documentIds);
        if (legacySourceResult.error) throw legacySourceResult.error;
        sourceDocuments.push(...(legacySourceResult.data || []));
      }
      const linkedNfeProductsByCte = groupLinkedNfeProducts(reservations, sourceDocuments);

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
        const mdfe = readCteMdfeDetails(d.cte_payload, d.cte_taker_role);
        const linkedNfeProducts = linkedNfeProductsByCte.get(d.id) || [];
        const fallbackTaker = mdfe.takerRole === 'destinatario'
          ? {
              name: d.recipient,
              taxId: d.recipient_cnpj,
              stateRegistration: recipientClient?.state_registration || null,
              street: recipientClient?.address_street || null,
              number: recipientClient?.address_number || null,
              neighborhood: recipientClient?.address_neighborhood || null,
              city: d.recipient_city || recipientClient?.address_city || null,
              cityIbge: recipientClient?.address_city_ibge_code || null,
              state: d.recipient_state || recipientClient?.address_state || null,
              zip: recipientClient?.address_zip || null,
            }
          : mdfe.takerRole === 'remetente'
            ? {
                name: d.remitter,
                taxId: d.remitter_cnpj,
                stateRegistration: hubDetails.remitter.stateRegistration || client?.state_registration || null,
                street: hubDetails.remitter.street || client?.address_street || null,
                number: hubDetails.remitter.number || client?.address_number || null,
                neighborhood: hubDetails.remitter.neighborhood || client?.address_neighborhood || null,
                city: hubDetails.remitter.city || client?.address_city || null,
                cityIbge: hubDetails.remitter.cityIbge || client?.address_city_ibge_code || null,
                state: hubDetails.remitter.state || client?.address_state || null,
                zip: hubDetails.remitter.zip || client?.address_zip || null,
              }
            : null;
        const taker = mdfe.taker || fallbackTaker;
        const insuranceEndorsements = [
          String(d.insurer_endorsement || '').trim(),
          ...mdfe.insuranceEndorsements,
        ].filter(Boolean);
        const cargoValue = mdfe.cargoValue ?? (
          d.insured_amount == null ? null : Number(d.insured_amount)
        );

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
          cargo_value: cargoValue,
          cargo_weight: d.weight_kg ? Number(d.weight_kg) : 0,
          predominant_product: deriveMdfePredominantProduct([{
            predominant_product: mdfe.predominantProduct,
            linked_nfe_products: linkedNfeProducts,
          }]) || null,
          linked_nfe_products: linkedNfeProducts,
          taker_role: mdfe.takerRole,
          taker_name: taker?.name || null,
          taker_document: taker?.taxId || null,
          taker_ie: taker?.stateRegistration || null,
          taker_street: taker?.street || null,
          taker_number: taker?.number || null,
          taker_neighborhood: taker?.neighborhood || null,
          taker_city: taker?.city || null,
          taker_city_ibge: taker?.cityIbge || null,
          taker_state: taker?.state || null,
          taker_zip: taker?.zip || null,
          insurance_endorsements: [...new Set(insuranceEndorsements)],
          load_ids: loadIdsByCte.get(d.id) || [],
        };
      });
    }
  });
}
