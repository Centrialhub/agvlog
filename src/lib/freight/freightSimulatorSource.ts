import { supabase } from '@/integrations/supabase/client';

/** Legacy CT-e rows identify the carrier, not the NF sender. Require an explicit supplier. */
export async function readFreightSimulatorSource(tenantId: string, documentId: string, supplierId: string | null) {
  const { data: document, error } = await supabase.from('fiscal_documents')
    .select('id, client_id, document_type').eq('tenant_id', tenantId)
    .eq('id', documentId).is('deleted_at', null).single();
  if (error) throw error;
  if (document.document_type !== 'inbound' && !supplierId) {
    throw new Error('Para simular um CT-e, selecione o fornecedor/remetente das NF-es de origem.');
  }
  return { recipientId: document.client_id,
    sourceDocumentIds: document.document_type === 'inbound' ? [document.id] : undefined };
}
