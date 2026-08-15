import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
function nz(v) {
    if (!v)
        return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
}
export function useBillingDocuments(filters) {
    const { currentTenant } = useTenant();
    const f = {
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
            if (!currentTenant)
                return [];
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
            if (f.clientId)
                q = q.eq('client_id', f.clientId);
            if (f.supplierId)
                q = q.eq('supplier_id', f.supplierId);
            if (f.periodStart)
                q = q.gte('issue_date', f.periodStart);
            if (f.periodEnd)
                q = q.lte('issue_date', f.periodEnd);
            if (f.invoiceNumber)
                q = q.ilike('invoice_number', `%${f.invoiceNumber}%`);
            if (f.accessKey)
                q = q.ilike('access_key', `%${f.accessKey}%`);
            if (f.remitter)
                q = q.ilike('remitter', `%${f.remitter}%`);
            if (f.referenceNumber) {
                // Busca em ambas as colunas: reference_number (interno) e client_load_number (cliente)
                const ref = f.referenceNumber.replace(/[,()]/g, '');
                q = q.or(`reference_number.ilike.%${ref}%,client_load_number.ilike.%${ref}%`);
            }
            if (f.recipientCnpj) {
                const digits = f.recipientCnpj.replace(/\D/g, '');
                if (digits)
                    q = q.ilike('recipient_cnpj', `%${digits}%`);
            }
            if (f.remitterCnpj) {
                const digits = f.remitterCnpj.replace(/\D/g, '');
                if (digits)
                    q = q.ilike('remitter_cnpj', `%${digits}%`);
            }
            if (f.recipientCity)
                q = q.ilike('recipient_city', `%${f.recipientCity}%`);
            if (f.onlySpecificInvoices && Array.isArray(f.onlySpecificInvoices) && f.onlySpecificInvoices.length > 0) {
                q = q.in('invoice_number', f.onlySpecificInvoices);
            }
            // Limit alto pra não estourar o default de 1000 do Supabase em tenants grandes
            q = q.order('issue_date', { ascending: false }).limit(5000);
            const { data, error } = await q;
            if (error)
                throw error;
            const docs = (data || []);
            // 1. O cross-reference server-side via SQL (cte_emitted_at IS NULL) já pegou autorizados/processados.
            // 2. Agora buscamos cross-reference em memória para rascunhos 'issued' ou 'processing' que ainda não marcaram a NF.
            const [{ data: emitted }, { data: nfse }] = await Promise.all([
                supabase
                    .from('cte_documents')
                    .select('fiscal_document_ids')
                    .eq('tenant_id', currentTenant.id)
                    .not('status', 'in', '("cancelled","rejected","error","failed")'),
                supabase
                    .from('nfse_documents')
                    .select('fiscal_document_ids')
                    .eq('tenant_id', currentTenant.id)
                    .not('status', 'in', '("cancelled","rejected","error","failed")')
            ]);
            const emittedIds = new Set();
            const processRow = (row) => {
                const rawIds = row.fiscal_document_ids;
                if (!rawIds)
                    return;
                let ids = [];
                try {
                    ids = Array.isArray(rawIds) ? rawIds : (typeof rawIds === 'string' ? JSON.parse(rawIds) : []);
                }
                catch (e) {
                    console.warn('[useBillingDocuments] falha ao parsear ids', e);
                }
                if (Array.isArray(ids)) {
                    for (const id of ids)
                        if (id)
                            emittedIds.add(id);
                }
            };
            (emitted || []).forEach(processRow);
            (nfse || []).forEach(processRow);
            return docs.filter(d => !emittedIds.has(d.id));
        },
        enabled: !!currentTenant,
        // Mantém o resultado anterior visível enquanto refiltra (digitação fluida)
        placeholderData: (prev) => prev,
        staleTime: 30000,
    });
}
