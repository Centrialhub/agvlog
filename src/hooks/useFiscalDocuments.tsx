import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { calculateFreight, logFreightCalculation } from './useFreightCalculator';
import {
  DuplicateFiscalDocumentError,
  isUniqueViolation,
  normalizeTaxId,
  normalizeFiscalNumber,
} from '@/lib/fiscalDocuments/fiscalIdentity';

const FREIGHT_TRIGGER_FIELDS = [
  'recipient',
  'recipient_state',
  'recipient_city',
  'recipient_neighborhood',
  'weight_kg',
  'pallet_count',
];

export const DOC_TYPES = ['inbound', 'outbound', 'transfer'] as const;
export type DocType = typeof DOC_TYPES[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  inbound: 'NF-e Entrada',
  outbound: 'CT-e / Saída',
  transfer: 'Transferência',
};

export const DOC_STATUSES = ['pending', 'confirmed', 'cancelled'] as const;
export type DocStatus = typeof DOC_STATUSES[number];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  pending: 'Pendente',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
};

export interface FiscalDocument {
  id: string;
  tenant_id: string;
  document_type: DocType;
  invoice_number: string | null;
  invoice_series: string | null;
  fiscal_model: string | null;
  access_key: string | null;
  client_id: string | null;
  remitter: string | null;
  remitter_cnpj: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_neighborhood: string | null;
  issue_date: string | null;
  order_id: string | null;
  load_id: string | null;
  pickup_order_id: string | null;
  product_summary: string | null;
  pallet_count: number;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  freight_breakdown: any | null;
  freight_table_id: string | null;
  client_load_number: string | null;
  client_load_source: any | null;
  delivery_meta?: any | null;
  cbs_base: number | null;
  cbs_rate: number | null;
  cbs_value: number | null;
  ibs_base: number | null;
  ibs_rate: number | null;
  ibs_value: number | null;
  status: string;
  created_at: string;
  clients?: { company_name: string } | null;
  loads?: { load_number: string } | null;
  orders?: { order_number: string } | null;
}

export function useFiscalDocuments() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['fiscal_documents', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('*, clients!fiscal_documents_client_id_fkey(company_name), loads(load_number), orders(order_number)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as FiscalDocument[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateFiscalDocument() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<FiscalDocument>) => {
      const { data, error } = await supabase.from('fiscal_documents').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
      if (error) {
        if (isUniqueViolation(error) && values.document_type === 'inbound') {
          const existing = await findExistingFiscalDocument({
            tenantId: currentTenant!.id,
            accessKey: values.access_key,
            remitterCnpj: (values as any).remitter_cnpj,
            invoiceNumber: values.invoice_number,
            invoiceSeries: (values as any).invoice_series,
            fiscalModel: (values as any).fiscal_model,
          });
          throw new DuplicateFiscalDocumentError(existing, (error as any).constraint);
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fiscal_documents'] }),
  });
}

/**
 * Look up a fiscal document (inbound) that matches either the access key or
 * the composite fiscal identity. Used to enrich duplicate errors.
 */
export async function findExistingFiscalDocument(input: {
  tenantId: string;
  accessKey?: string | null;
  remitterCnpj?: string | null;
  invoiceNumber?: string | null;
  invoiceSeries?: string | null;
  fiscalModel?: string | null;
}): Promise<FiscalDocument | null> {
  const accessKey = normalizeTaxId(input.accessKey);
  if (accessKey) {
    const { data } = await supabase
      .from('fiscal_documents')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('document_type', 'inbound')
      .eq('access_key', accessKey)
      .maybeSingle();
    if (data) return data as FiscalDocument;
  }
  const cnpj = normalizeTaxId(input.remitterCnpj);
  const number = normalizeFiscalNumber(input.invoiceNumber);
  if (cnpj && number) {
    const series = normalizeFiscalNumber(input.invoiceSeries) || '0';
    const model = normalizeFiscalNumber(input.fiscalModel) || '55';
    const { data } = await supabase
      .from('fiscal_documents')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('document_type', 'inbound')
      .eq('remitter_cnpj', cnpj)
      .eq('invoice_number', input.invoiceNumber as string)
      .maybeSingle();
    if (data) return data as FiscalDocument;
    // Fallback: broader search, since stored values may differ in formatting
    const { data: broad } = await supabase
      .from('fiscal_documents')
      .select('*')
      .eq('tenant_id', input.tenantId)
      .eq('document_type', 'inbound')
      .limit(50);
    const match = (broad || []).find((d: any) =>
      normalizeTaxId(d.remitter_cnpj) === cnpj &&
      normalizeFiscalNumber(d.invoice_number) === number &&
      (normalizeFiscalNumber(d.invoice_series) || '0') === series &&
      (normalizeFiscalNumber(d.fiscal_model) || '55') === model,
    );
    return (match as FiscalDocument) || null;
  }
  return null;
}

export function useUpdateFiscalDocument() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<FiscalDocument> & { id: string }) => {
      const { data, error } = await supabase.from('fiscal_documents').update({
        ...values,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;

      // Auto-recalc freight when destination/weight/pallets change on a CT-e (outbound)
      // and the freight isn't manually overridden
      try {
        const triggered = FREIGHT_TRIGGER_FIELDS.some((f) => f in values);
        const doc: any = data;
        if (
          triggered &&
          currentTenant &&
          doc &&
          doc.document_type === 'outbound' &&
          !doc.freight_overridden
        ) {
          // Pull NF-e context from the same load
          let clientId: string | null = doc.client_id || null;
          let nfeTotalValue = 0;
          if (doc.load_id) {
            const { data: nfeDocs } = await supabase
              .from('fiscal_documents')
              .select('client_id, value')
              .eq('load_id', doc.load_id)
              .eq('tenant_id', currentTenant.id)
              .eq('document_type', 'inbound');
            nfeTotalValue = (nfeDocs || []).reduce((s: number, d: any) => s + (Number(d.value) || 0), 0);
            if (!clientId) {
              const ref = (nfeDocs || []).find((d: any) => d.client_id);
              clientId = ref ? (ref as any).client_id : null;
            }
          }
          let payerGroup: string | null = null;
          if (clientId) {
            const { data: cli } = await supabase
              .from('clients').select('payer_group').eq('id', clientId).maybeSingle();
            payerGroup = (cli as any)?.payer_group || null;
          }

          const result = await calculateFreight({
            tenantId: currentTenant.id,
            clientId,
            payerGroup,
            destination: doc.recipient || doc.recipient_city,
            destinationState: doc.recipient_state,
            destinationMunicipality: doc.recipient_city,
            totalValue: nfeTotalValue,
            totalWeight: Number(doc.weight_kg) || 0,
            totalPallets: Number(doc.pallet_count) || 0,
          });

          if (result.success && result.breakdown) {
            const v = result.value;
            const cbsRate = 0.90, ibsRate = 0.10;
            await supabase.from('fiscal_documents').update({
              freight_value: v,
              freight_value_original: v,
              value: v,
              freight_table_id: result.breakdown.tableId || null,
              freight_breakdown: result.breakdown as any,
              cbs_base: v, cbs_rate: cbsRate, cbs_value: v * cbsRate / 100,
              ibs_base: v, ibs_rate: ibsRate, ibs_value: v * ibsRate / 100,
              updated_at: new Date().toISOString(),
            } as any).eq('id', id);

            await logFreightCalculation(currentTenant.id, id, 'cte', result.breakdown, user?.id);
          }
        }
      } catch (e) {
        console.warn('[useUpdateFiscalDocument] auto-recalc falhou', e);
      }

      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['load_documents'] });
    },
  });
}
