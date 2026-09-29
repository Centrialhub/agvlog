import { supabase } from '@/integrations/supabase/client';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import type { FreightInput } from '@/hooks/useFreightCalculator';

/** The recipient stays in clientId; tariff ownership belongs to the NF sender. */
export async function resolveFreightSupplier(input: FreightInput): Promise<FreightInput> {
  let taxIds = input.supplierTaxIds;
  if (input.sourceDocumentIds) {
    const ids = [...new Set(input.sourceDocumentIds)];
    if (!ids.length) throw new Error('Selecione as NF-es de origem para identificar o fornecedor.');
    const documents: { id: string; remitter_cnpj: string | null }[] = [];
    for (let start = 0; start < ids.length; start += 200) {
      const page = await fetchAllPostgrestPages((from, to) => supabase.from('fiscal_documents')
        .select('id, remitter_cnpj').eq('tenant_id', input.tenantId)
        .eq('document_type', 'inbound').is('deleted_at', null)
        .in('id', ids.slice(start, start + 200)).order('id').range(from, to));
      documents.push(...page);
    }
    if (documents.length !== ids.length) throw new Error('Uma NF-e de origem está indisponível para conferir o fornecedor.');
    taxIds = documents.map(document => document.remitter_cnpj);
  }
  const digits = (value: string | null | undefined) => (value || '').replace(/\D/g, '');
  let taxId: string | undefined;
  if (taxIds !== undefined) {
    if (!taxIds.length || taxIds.some(value => ![11, 14].includes(digits(value).length))) {
      throw new Error('Informe o CPF/CNPJ do remetente da NF-e para calcular o frete.');
    }
    const distinct = [...new Set(taxIds.map(digits))];
    if (distinct.length !== 1) throw new Error('As NF-es possuem fornecedores diferentes. Calcule o frete por fornecedor.');
    taxId = distinct[0];
  }
  if (!taxId && !input.supplierId) {
    // Simulator can still explicitly evaluate generic tariffs without a supplier.
    return input;
  }
  const suppliers = await fetchAllPostgrestPages((from, to) => {
    let query = supabase.from('clients').select('id, tax_id, payer_group')
      .eq('tenant_id', input.tenantId).eq('is_supplier', true).order('id').range(from, to);
    if (input.supplierId) query = query.eq('id', input.supplierId);
    return query;
  });
  const matches = suppliers.filter(supplier => !taxId || digits(supplier.tax_id) === taxId);
  if (matches.length !== 1) {
    throw new Error(matches.length ? 'Mais de um fornecedor cadastrado possui o CPF/CNPJ do remetente.'
      : 'Remetente da NF-e não encontrado no cadastro de fornecedores da empresa.');
  }
  return { ...input, supplierId: matches[0].id, payerGroup: input.payerGroup || matches[0].payer_group };
}
