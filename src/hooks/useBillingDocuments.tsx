import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { FiscalDocument } from './useFiscalDocuments';
import { cteConsumesInvoices, isBillableNfse } from '@/lib/fiscal/documentStatus';

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
}

function nz(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function useBillingDocuments(filters: BillingDocumentFilters) {
  const { currentTenant } = useTenant();

  const f: Required<{ [K in keyof BillingDocumentFilters]: string | null }> = {
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
        .is('deleted_at', null)
        // Oculta NFs que já geraram CT-e ou NFS-e no nível da linha (emissões confirmadas)
        .is('cte_emitted_at', null)
        .is('nfse_emitted_at', null);

      if (f.clientId) q = q.eq('client_id', f.clientId);
      if (f.supplierId) q = q.eq('supplier_id', f.supplierId);
      if (f.periodStart) q = q.gte('issue_date', f.periodStart);
      if (f.periodEnd) q = q.lte('issue_date', f.periodEnd);
      if (f.invoiceNumber) q = q.ilike('invoice_number', `%${f.invoiceNumber}%`);
      if (f.accessKey) q = q.ilike('access_key', `%${f.accessKey}%`);
      if (f.remitter) q = q.ilike('remitter', `%${f.remitter}%`);
      if (f.referenceNumber) {
        // Busca em ambas as colunas: reference_number (interno) e client_load_number (cliente)
        const ref = f.referenceNumber.replace(/[,()]/g, '');
        q = q.or(`reference_number.ilike.%${ref}%,client_load_number.ilike.%${ref}%`);
      }
      if (f.recipientCnpj) {
        const digits = f.recipientCnpj.replace(/\D/g, '');
        if (digits) q = q.ilike('recipient_cnpj', `%${digits}%`);
      }
      if (f.remitterCnpj) {
        const digits = f.remitterCnpj.replace(/\D/g, '');
        if (digits) q = q.ilike('remitter_cnpj', `%${digits}%`);
      }
      if (f.recipientCity) q = q.ilike('recipient_city', `%${f.recipientCity}%`);

      // Limit alto pra não estourar o default de 1000 do Supabase em tenants grandes
      q = q.order('issue_date', { ascending: false }).limit(5000);

      const { data, error } = await q;
      if (error) throw error;
      const docs = (data || []) as FiscalDocument[];

      // Remove documentos já consumidos por um CT-e não anulado — inclusive
      // rascunhos/lotes. Mesmo critério de `usePendingInvoices` (cteConsumesInvoices),
      // para que o pool de faturamento e o KPI de pendentes nunca divirjam.
      // Remove documentos já consumidos por um CT-e ou NFS-e não anulado.
      // Priorizamos a flag no banco (cte_emitted_at/nfse_emitted_at), mas cross-referenciamos
      // com rascunhos em memória para evitar que notas em processamento reapareçam.
      const { data: emitted, error: emittedErr } = await supabase
        .from('cte_documents')
        .select('fiscal_document_ids, status')
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null)
        .not('status', 'in', '("cancelled","rejected","error","failed")'); // Pula documentos que falharam e deveriam liberar as NFs
      if (emittedErr) throw emittedErr;

      const emittedIds = new Set<string>();
      for (const row of emitted || []) {
        if (!row.fiscal_document_ids) continue;
        for (const id of row.fiscal_document_ids) {
          if (id) emittedIds.add(id);
        }
      }

      const { data: nfse, error: nfseErr } = await supabase
        .from('nfse_documents')
        .select('fiscal_document_ids, status')
        .eq('tenant_id', currentTenant.id)
        .not('status', 'in', '("cancelled","rejected","error","failed")');
      if (nfseErr) throw nfseErr;

      for (const row of nfse || []) {
        if (!row.fiscal_document_ids) continue;
        for (const id of row.fiscal_document_ids) {
          if (id) emittedIds.add(id);
        }
      }

      // Além do filtro SQL direto nas flags cte_emitted_at/nfse_emitted_at (que pega documentos autorizados),
      // este filtro final em JS remove rascunhos e lotes pendentes identificados acima.
      return docs.filter(d => !emittedIds.has(d.id));
    },
    enabled: !!currentTenant,
    // Mantém o resultado anterior visível enquanto refiltra (digitação fluida)
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}