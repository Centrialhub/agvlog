import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useDefaultEmitter } from './useEmitters';
import { isSameFiscalMunicipality } from '@/lib/fiscal/fiscalMunicipality';
import { normalizeCity } from '@/lib/utils/normalizeCity';
import type { FiscalDocument } from './useFiscalDocuments';

/**
 * Filtros de notas não faturadas para CT-e e NFS-e.
 * Empurra o máximo possível para o Postgres aproveitando os índices:
 *  - btree composto (tenant_id, client_id, issue_date)
 *  - btree composto (tenant_id, document_type, status)
 *  - GIN trigram em invoice_number, access_key, remitter, client_load_number
 *
 * Filtros que tocam colunas de loads/vehicles (placa, romaneio, status da carga, op_type)
 * continuam no client porque dependem de tabelas relacionadas — mas o universo já chega
 * pré-filtrado pelo cliente + período + substrings de NF.
 */
export interface BillingDocumentFilters {
  clientId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  invoiceNumber?: string | null;
  accessKey?: string | null;
  remitter?: string | null;
  referenceNumber?: string | null; // client_load_number
  recipientCnpj?: string | null;
  remitterCnpj?: string | null;
  supplierId?: string | null;
  recipientCity?: string | null;
  onlySpecificInvoices?: string[] | null;
}

const PAGE_SIZE = 500;

async function readAllPages<T>(read: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await read(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

function nz(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function useBillingDocuments(filters: BillingDocumentFilters, target: 'all' | 'cte' | 'nfse' = 'all') {
  const { currentTenant } = useTenant();
  const emitterQuery = useDefaultEmitter();
  const emitter = target === 'all' ? null : emitterQuery.data;

  const f: Required<{ [K in keyof BillingDocumentFilters]: string | string[] | null }> = {
    clientId: nz(filters.clientId),
    periodStart: nz(filters.periodStart),
    periodEnd: nz(filters.periodEnd),
    invoiceNumber: nz(filters.invoiceNumber),
    accessKey: nz(filters.accessKey),
    remitter: nz(filters.remitter),
    referenceNumber: nz(filters.referenceNumber),
    recipientCnpj: nz(filters.recipientCnpj),
    remitterCnpj: nz(filters.remitterCnpj),
    supplierId: nz(filters.supplierId),
    recipientCity: nz(filters.recipientCity),
    onlySpecificInvoices: filters.onlySpecificInvoices || null,
  };

  return useQuery({
    queryKey: ['billing_documents', currentTenant?.id, target, f, emitter?.id, emitter?.city_code, emitter?.endereco],
    queryFn: async () => {
      if (!currentTenant) return [];

      if (target !== 'all' && emitterQuery.error) throw emitterQuery.error;
      if (target !== 'all' && !emitter) throw new Error('Cadastre um emitente ativo para separar as notas por município.');
      const makeQuery = () => {
        let q = supabase
          .from('fiscal_documents')
          .select('*, clients!fiscal_documents_client_id_fkey(company_name), loads(load_number, operation_type), orders(order_number)')
          .eq('tenant_id', currentTenant.id)
          // Pré-filtros aplicados em todas as queries de Billing — usam idx_fiscal_documents_tenant_type_status
          .eq('document_type', 'inbound')
          .neq('status', 'cancelled')
          .is('deleted_at', null);

        // Selecting an invoice number must never bypass an existing fiscal emission.
        q = q.is('cte_emitted_at', null).is('nfse_emitted_at', null);

        if (f.clientId) q = q.eq('client_id', f.clientId as string);
        if (f.supplierId) q = q.eq('supplier_id', f.supplierId as string);
        if (f.periodStart) q = q.gte('issue_date', f.periodStart as string);
        if (f.periodEnd) q = q.lte('issue_date', f.periodEnd as string);
        if (f.invoiceNumber) q = q.ilike('invoice_number', `%${f.invoiceNumber as string}%`);
        if (f.accessKey) q = q.ilike('access_key', `%${f.accessKey as string}%`);
        if (f.remitter) q = q.ilike('remitter', `%${f.remitter as string}%`);
        if (f.referenceNumber) {
          // Busca em ambas as colunas: reference_number (interno) e client_load_number (cliente)
          const ref = (f.referenceNumber as string).replace(/[,()]/g, '');
          q = q.or(`reference_number.ilike.%${ref}%,client_load_number.ilike.%${ref}%`);
        }
        if (f.recipientCnpj) {
          const digits = (f.recipientCnpj as string).replace(/\D/g, '');
          if (digits) q = q.ilike('recipient_cnpj', `%${digits}%`);
        }
        if (f.remitterCnpj) {
          const digits = (f.remitterCnpj as string).replace(/\D/g, '');
          if (digits) q = q.ilike('remitter_cnpj', `%${digits}%`);
        }
        // City names are accent-normalized below; SQL ILIKE alone would hide Janaúba when searching Janauba.
        if (f.onlySpecificInvoices && Array.isArray(f.onlySpecificInvoices) && f.onlySpecificInvoices.length > 0) {
          q = q.in('invoice_number', f.onlySpecificInvoices);
        }

        return q.order('created_at', { ascending: false }).order('id', { ascending: false });
      };
      // Page below PostgREST's response cap; a large limit does not override that cap.
      const docs = await readAllPages((start, end) => makeQuery().range(start, end)) as FiscalDocument[];

      // Emissões em andamento também reservam a NF; rascunhos, prévias e falhas não.
      const [emitted, nfse] = await Promise.all([
        readAllPages((start, end) => supabase
          .from('cte_documents')
          .select('fiscal_document_ids')
          .eq('tenant_id', currentTenant.id)
          .eq('is_voided', false).is('cancelled_at', null)
          .not('status', 'in', '("cancelled","rejected","error","failed","sefaz_error","draft","generated")')
          .order('id').range(start, end)),
        readAllPages((start, end) => supabase
          .from('nfse_documents')
          .select('fiscal_document_ids')
          .eq('tenant_id', currentTenant.id)
          .eq('cancelled', false).eq('is_preview', false)
          .not('status', 'in', '("cancelled","rejected","error","failed","sefaz_error","draft","generated")')
          .order('id').range(start, end)),
      ]);

      const emittedIds = new Set<string>();
      
      const processRow = (row: { fiscal_document_ids: unknown }) => {
        const rawIds = row.fiscal_document_ids;
        if (!rawIds) return;
        let ids: string[] = [];
        try {
          ids = Array.isArray(rawIds) ? rawIds : (typeof rawIds === 'string' ? JSON.parse(rawIds) : []);
        } catch (e) {
          console.warn('[useBillingDocuments] falha ao parsear ids', e);
        }
        if (Array.isArray(ids)) {
          for (const id of ids) if (id) emittedIds.add(id);
        }
      };

      (emitted || []).forEach(processRow);
      (nfse || []).forEach(processRow);

      return docs.filter(d => {
        if (emittedIds.has(d.id)) return false;
        if (f.recipientCity && !normalizeCity(d.recipient_city).includes(normalizeCity(f.recipientCity as string))) return false;
        const sameCity = !!emitter && isSameFiscalMunicipality(
          { city: d.recipient_city, state: d.recipient_state },
          { city: emitter.endereco?.municipio, state: emitter.endereco?.uf, code: emitter.city_code },
        );
        return target === 'all' || (target === 'cte' ? !sameCity : sameCity);
      });
    },
    enabled: !!currentTenant && (target === 'all' || !emitterQuery.isLoading),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}
