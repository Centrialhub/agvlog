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
import type { Database, Json, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

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
  remitter_state_registration?: string | null;
  recipient: string | null;
  recipient_cnpj?: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  recipient_neighborhood: string | null;
  issue_date: string | null;
  order_id: string | null;
  operation_type: Database['public']['Enums']['operation_type'] | null;
  load_id: string | null;
  pickup_order_id: string | null;
  product_summary: string | null;
  pallet_count: number;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  freight_breakdown: Json | null;
  freight_table_id: string | null;
  client_load_number: string | null;
  client_load_source: Json | null;
  reference_number?: string | null;
  delivery_meta?: Json | null;
  insurer_name?: string | null;
  insurer_cnpj?: string | null;
  insurer_policy?: string | null;
  insurer_endorsement?: string | null;
  insured_amount?: number | null;
  insurance_premium?: number | null;
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

export type CreateFiscalDocumentInput = Omit<
  TablesInsert<'fiscal_documents'>,
  'tenant_id' | 'created_by'
>;

export type UpdateFiscalDocumentInput = Omit<
  TablesUpdate<'fiscal_documents'>,
  'id' | 'tenant_id' | 'updated_at'
> & { id: string };

interface FiscalDocumentPageInput {
  page: number;
  pageSize: number;
  search?: string;
  typeFilter?: string;
  statusFilter?: string;
  loadFilter?: string;
}

export interface FiscalDocumentPage {
  rows: FiscalDocument[];
  totalCount: number;
}

export interface FiscalDocumentSummary {
  totalCount: number;
  inboundCount: number;
  outboundCount: number;
  pendingCount: number;
  totalValue: number;
  totalWeight: number;
  totalPallets: number;
}

function safePostgrestSearch(input: string): string {
  return input.trim().replace(/[,%()"\\]/g, ' ').replace(/\s+/g, ' ');
}

export function useFiscalDocumentsPage({
  page,
  pageSize,
  search = '',
  typeFilter = 'all',
  statusFilter = 'all',
  loadFilter = 'all',
}: FiscalDocumentPageInput) {
  const { currentTenant } = useTenant();
  const normalizedSearch = safePostgrestSearch(search);

  return useQuery({
    queryKey: [
      'fiscal_documents', 'page', currentTenant?.id, page, pageSize,
      normalizedSearch, typeFilter, statusFilter, loadFilter,
    ],
    queryFn: async (): Promise<FiscalDocumentPage> => {
      if (!currentTenant) return { rows: [], totalCount: 0 };

      let matchingClientIds: string[] = [];
      if (normalizedSearch) {
        const { data: matchingClients, error: clientsError } = await supabase
          .from('clients')
          .select('id')
          .eq('tenant_id', currentTenant.id)
          .ilike('company_name', `%${normalizedSearch}%`)
          .limit(100);
        if (clientsError) throw clientsError;
        matchingClientIds = (matchingClients || []).map(client => client.id);
      }

      let query = supabase
        .from('fiscal_documents')
        .select('*, clients!fiscal_documents_client_id_fkey(company_name), loads(load_number), orders(order_number)', { count: 'exact' })
        .eq('tenant_id', currentTenant.id)
        .is('deleted_at', null);

      if (normalizedSearch) {
        const pattern = `*${normalizedSearch}*`;
        const filters = [
          `invoice_number.ilike.${pattern}`,
          `remitter.ilike.${pattern}`,
          `recipient.ilike.${pattern}`,
          `access_key.ilike.${pattern}`,
        ];
        if (matchingClientIds.length > 0) {
          filters.push(`client_id.in.(${matchingClientIds.join(',')})`);
        }
        query = query.or(filters.join(','));
      }
      if (typeFilter !== 'all') query = query.eq('document_type', typeFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (loadFilter === 'no_load') query = query.is('load_id', null);
      if (loadFilter === 'with_load') query = query.not('load_id', 'is', null);

      const from = (page - 1) * pageSize;
      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      return { rows: (data || []) as FiscalDocument[], totalCount: count || 0 };
    },
    enabled: !!currentTenant,
    placeholderData: previous => previous,
  });
}

export function useFiscalDocumentSummary() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['fiscal_documents', 'summary', currentTenant?.id],
    queryFn: async (): Promise<FiscalDocumentSummary> => {
      if (!currentTenant) {
        return {
          totalCount: 0, inboundCount: 0, outboundCount: 0, pendingCount: 0,
          totalValue: 0, totalWeight: 0, totalPallets: 0,
        };
      }
      const { data, error } = await supabase.rpc('get_fiscal_document_summary_v1', {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      const row = data?.[0];
      return {
        totalCount: Number(row?.total_count) || 0,
        inboundCount: Number(row?.inbound_count) || 0,
        outboundCount: Number(row?.outbound_count) || 0,
        pendingCount: Number(row?.pending_count) || 0,
        totalValue: Number(row?.total_value) || 0,
        totalWeight: Number(row?.total_weight) || 0,
        totalPallets: Number(row?.total_pallets) || 0,
      };
    },
    enabled: !!currentTenant,
  });
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
        .is('deleted_at', null)
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
    mutationFn: async (values: CreateFiscalDocumentInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload: TablesInsert<'fiscal_documents'> = {
        ...values,
        tenant_id: currentTenant.id,
        created_by: user?.id ?? null,
      };
      const { data, error } = await supabase.from('fiscal_documents').insert(payload).select().single();
      if (error) {
        if (isUniqueViolation(error) && values.document_type === 'inbound') {
          const existing = await findExistingFiscalDocument({
            tenantId: currentTenant.id,
            accessKey: values.access_key,
            remitterCnpj: values.remitter_cnpj,
            invoiceNumber: values.invoice_number,
            invoiceSeries: values.invoice_series,
            fiscalModel: values.fiscal_model,
          });
          const constraint = 'constraint' in error && typeof error.constraint === 'string'
            ? error.constraint
            : undefined;
          throw new DuplicateFiscalDocumentError(existing, constraint);
        }
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      for (const key of ['fiscal_documents', 'billing_documents', 'pending_invoices_summary'])
        void qc.invalidateQueries({ queryKey: [key] });
    },
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
    const match = (broad || []).find((d) =>
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
    mutationFn: async ({ id, ...values }: UpdateFiscalDocumentInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const updatePayload: TablesUpdate<'fiscal_documents'> = {
        ...values,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('fiscal_documents')
        .update(updatePayload)
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .select()
        .single();
      if (error) throw error;

      // Auto-recalc freight when destination/weight/pallets change on a CT-e (outbound)
      // and the freight isn't manually overridden
      try {
        const triggered = FREIGHT_TRIGGER_FIELDS.some((f) => f in values);
        const doc = data;
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
            const { data: nfeDocs, error: nfeError } = await supabase
              .from('fiscal_documents')
              .select('client_id, value')
              .eq('load_id', doc.load_id)
              .eq('tenant_id', currentTenant.id)
              .eq('document_type', 'inbound');
            if (nfeError) throw nfeError;
            nfeTotalValue = (nfeDocs || []).reduce((sum, document) => sum + (Number(document.value) || 0), 0);
            if (!clientId) {
              const ref = (nfeDocs || []).find((document) => document.client_id);
              clientId = ref?.client_id || null;
            }
          }
          let payerGroup: string | null = null;
          if (clientId) {
            const { data: cli, error: clientError } = await supabase
              .from('clients')
              .select('payer_group')
              .eq('id', clientId)
              .eq('tenant_id', currentTenant.id)
              .maybeSingle();
            if (clientError) throw clientError;
            payerGroup = cli?.payer_group || null;
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
            const freightUpdate = {
              freight_value: v,
              freight_value_original: v,
              value: v,
              freight_table_id: result.breakdown.tableId || null,
              freight_breakdown: result.breakdown as unknown as Json,
              cbs_base: v, cbs_rate: cbsRate, cbs_value: v * cbsRate / 100,
              ibs_base: v, ibs_rate: ibsRate, ibs_value: v * ibsRate / 100,
              updated_at: new Date().toISOString(),
            } satisfies TablesUpdate<'fiscal_documents'>;
            const { error: freightUpdateError } = await supabase.from('fiscal_documents')
              .update(freightUpdate)
              .eq('id', id)
              .eq('tenant_id', currentTenant.id);
            if (freightUpdateError) throw freightUpdateError;

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
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
    },
  });
}
