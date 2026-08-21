import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { calculateFreight, logFreightCalculation } from './useFreightCalculator';
import { DuplicateFiscalDocumentError, isUniqueViolation, normalizeTaxId, normalizeFiscalNumber, } from '@/lib/fiscalDocuments/fiscalIdentity';
const FREIGHT_TRIGGER_FIELDS = [
    'recipient',
    'recipient_state',
    'recipient_city',
    'recipient_neighborhood',
    'weight_kg',
    'pallet_count',
];
export const DOC_TYPES = ['inbound', 'outbound', 'transfer'];
export const DOC_TYPE_LABELS = {
    inbound: 'NF-e Entrada',
    outbound: 'CT-e / Saída',
    transfer: 'Transferência',
};
export const DOC_STATUSES = ['pending', 'confirmed', 'cancelled'];
export const DOC_STATUS_LABELS = {
    pending: 'Pendente',
    confirmed: 'Confirmado',
    cancelled: 'Cancelado',
};
export function useFiscalDocuments() {
    const { currentTenant } = useTenant();
    return useQuery({
        queryKey: ['fiscal_documents', currentTenant?.id],
        queryFn: async () => {
            if (!currentTenant)
                return [];
            const { data, error } = await supabase
                .from('fiscal_documents')
                .select('*, clients!fiscal_documents_client_id_fkey(company_name), loads(load_number), orders(order_number)')
                .eq('tenant_id', currentTenant.id)
                .is('deleted_at', null)
                .order('created_at', { ascending: false });
            if (error)
                throw error;
            return (data || []);
        },
        enabled: !!currentTenant,
    });
}
export function useCreateFiscalDocument() {
    const { currentTenant } = useTenant();
    const { user } = useAuth();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async (values) => {
            const { data, error } = await supabase.from('fiscal_documents').insert({
                ...values,
                tenant_id: currentTenant.id,
                created_by: user?.id,
            }).select().single();
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
                    throw new DuplicateFiscalDocumentError(existing, error.constraint);
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
export async function findExistingFiscalDocument(input) {
    const accessKey = normalizeTaxId(input.accessKey);
    if (accessKey) {
        const { data } = await supabase
            .from('fiscal_documents')
            .select('*')
            .eq('tenant_id', input.tenantId)
            .eq('document_type', 'inbound')
            .eq('access_key', accessKey)
            .maybeSingle();
        if (data)
            return data;
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
            .eq('invoice_number', input.invoiceNumber)
            .maybeSingle();
        if (data)
            return data;
        // Fallback: broader search, since stored values may differ in formatting
        const { data: broad } = await supabase
            .from('fiscal_documents')
            .select('*')
            .eq('tenant_id', input.tenantId)
            .eq('document_type', 'inbound')
            .limit(50);
        const match = (broad || []).find((d) => normalizeTaxId(d.remitter_cnpj) === cnpj &&
            normalizeFiscalNumber(d.invoice_number) === number &&
            (normalizeFiscalNumber(d.invoice_series) || '0') === series &&
            (normalizeFiscalNumber(d.fiscal_model) || '55') === model);
        return match || null;
    }
    return null;
}
export function useUpdateFiscalDocument() {
    const { currentTenant } = useTenant();
    const { user } = useAuth();
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...values }) => {
            const { data, error } = await supabase.from('fiscal_documents').update({
                ...values,
                updated_at: new Date().toISOString(),
            }).eq('id', id).select().single();
            if (error)
                throw error;
            // Auto-recalc freight when destination/weight/pallets change on a CT-e (outbound)
            // and the freight isn't manually overridden
            try {
                const triggered = FREIGHT_TRIGGER_FIELDS.some((f) => f in values);
                const doc = data;
                if (triggered &&
                    currentTenant &&
                    doc &&
                    doc.document_type === 'outbound' &&
                    !doc.freight_overridden) {
                    // Pull NF-e context from the same load
                    let clientId = doc.client_id || null;
                    let nfeTotalValue = 0;
                    if (doc.load_id) {
                        const { data: nfeDocs } = await supabase
                            .from('fiscal_documents')
                            .select('client_id, value')
                            .eq('load_id', doc.load_id)
                            .eq('tenant_id', currentTenant.id)
                            .eq('document_type', 'inbound');
                        nfeTotalValue = (nfeDocs || []).reduce((s, d) => s + (Number(d.value) || 0), 0);
                        if (!clientId) {
                            const ref = (nfeDocs || []).find((d) => d.client_id);
                            clientId = ref ? ref.client_id : null;
                        }
                    }
                    let payerGroup = null;
                    if (clientId) {
                        const { data: cli } = await supabase
                            .from('clients').select('payer_group').eq('id', clientId).maybeSingle();
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
                        await supabase.from('fiscal_documents').update({
                            freight_value: v,
                            freight_value_original: v,
                            value: v,
                            freight_table_id: result.breakdown.tableId || null,
                            freight_breakdown: result.breakdown,
                            cbs_base: v, cbs_rate: cbsRate, cbs_value: v * cbsRate / 100,
                            ibs_base: v, ibs_rate: ibsRate, ibs_value: v * ibsRate / 100,
                            updated_at: new Date().toISOString(),
                        }).eq('id', id);
                        await logFreightCalculation(currentTenant.id, id, 'cte', result.breakdown, user?.id);
                    }
                }
            }
            catch (e) {
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
