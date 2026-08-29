import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { FiscalDocument } from './useFiscalDocuments';

/**
 * Filtros server-side para o Faturamento (CT-e).
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

function nz(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function useBillingDocuments(filters: BillingDocumentFilters) {
  const { currentTenant } = useTenant();

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
    queryKey: ['billing_documents', currentTenant?.id, f],
    queryFn: async () => {
      if (!currentTenant) return [];

      let q = supabase
        .from('fiscal_documents')
        .select('*, clients!fiscal_documents_client_id_fkey(company_name), loads(load_number, operation_type), orders(order_number)')
        .eq('tenant_id', currentTenant.id)
        // Pré-filtros aplicados em todas as queries de Billing — usam idx_fiscal_documents_tenant_type_status
        .eq('document_type', 'inbound')
        .neq('status', 'cancelled')
        .is('deleted_at', null);

      // Quando isolando notas específicas, removemos filtros restritivos de estado/emissão
      // para garantir que documentos problemáticos ou com flags órfãs apareçam.
      const isIsolating = f.onlySpecificInvoices && f.onlySpecificInvoices.length > 0;

      if (!isIsolating) {
        q = q.is('cte_emitted_at', null).is('nfse_emitted_at', null);
      } else {
        // Se estiver isolando, removemos filtros de status SEFAZ para forçar a exibição
        // mesmo que o banco ache que elas estão vinculadas, permitindo a correção via UI.
        q = q.eq('document_type', 'inbound'); 
      }

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
      if (f.recipientCity) q = q.ilike('recipient_city', `%${f.recipientCity as string}%`);
      if (f.onlySpecificInvoices && Array.isArray(f.onlySpecificInvoices) && f.onlySpecificInvoices.length > 0) {
        q = q.in('invoice_number', f.onlySpecificInvoices);
      }

      // Limit alto pra não estourar o default de 1000 do Supabase em tenants grandes
      q = q.order('issue_date', { ascending: false }).limit(5000);

      const { data, error } = await q;
      if (error) throw error;
      const docs = (data || []) as FiscalDocument[];

      // 1. O cross-reference server-side via SQL (cte_emitted_at IS NULL) já pegou autorizados/processados.
      // 2. Agora buscamos cross-reference em memória para rascunhos 'issued' ou 'processing' que ainda não marcaram a NF.
      const [{ data: emitted }, { data: nfse }] = await Promise.all([
        supabase
          .from('cte_documents')
          .select('fiscal_document_ids')
          .eq('tenant_id', currentTenant.id)
          .not('status', 'in', '("cancelled","rejected","error","failed","sefaz_error")'),
        supabase
          .from('nfse_documents')
          .select('fiscal_document_ids')
          .eq('tenant_id', currentTenant.id)
          .not('status', 'in', '("cancelled","rejected","error","failed","sefaz_error")')
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

      // Se estiver isolando, ignoramos a trava de memória (emittedIds)
      if (isIsolating) return docs;

      return docs.filter(d => !emittedIds.has(d.id));
    },
    enabled: !!currentTenant,
    // Mantém o resultado anterior visível enquanto refiltra (digitação fluida)
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}
