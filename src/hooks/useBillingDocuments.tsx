import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { FiscalDocument } from './useFiscalDocuments';
import { cteConsumesInvoices } from '@/lib/fiscal/documentStatus';

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
        .select('*, clients!fiscal_documents_client_id_fkey(company_name), loads(load_number), orders(order_number)')
        .eq('tenant_id', currentTenant.id)
        // Pré-filtros aplicados em todas as queries de Billing — usam idx_fiscal_documents_tenant_type_status
        .eq('document_type', 'inbound')
        .neq('status', 'cancelled')
        .is('deleted_at', null)
        // Oculta NFs que já geraram CT-e (emissão direta) — evita dupla emissão.
        // Cancelar o CT-e limpa este campo e a NF volta ao pool.
        .is('cte_emitted_at', null)
        // Também oculta NFs já usadas em NFS-e — a mesma NF não pode gerar dois
        // documentos fiscais de saída (regra: uma NF vira 1 CT-e OU 1 NFS-e).
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
      const { data: emitted, error: emittedErr } = await supabase
        .from('cte_documents')
        .select('fiscal_document_ids, status')
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null);
      if (emittedErr) throw emittedErr;

      const emittedIds = new Set<string>();
      for (const row of emitted || []) {
        if (!cteConsumesInvoices(row as any)) continue;
        for (const id of ((row as { fiscal_document_ids: string[] | null }).fiscal_document_ids || [])) {
          if (id) emittedIds.add(id);
        }
      }

      return docs.filter(d => !emittedIds.has(d.id));
    },
    enabled: !!currentTenant,
    // Mantém o resultado anterior visível enquanto refiltra (digitação fluida)
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}