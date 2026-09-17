import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useTenant } from './useTenant';

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível excluir o registro.';

/**
 * Exclui um registro de CT-e que esteja em estado de erro (sefaz-error).
 * Isso serve para "limpar" a visualização de tentativas que falharam antes mesmo de gerar um hub_document_id.
 */
export function useDeleteFailedCTe() {
  const toast = useSonnerToast();
  const qc = useQueryClient();
  const { currentTenant } = useTenant();

  return useMutation({
    mutationFn: async (fiscalDocumentId: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      // 1. Tenta buscar em fiscal_documents (emissões reais/tentativas no Hub)
      const { data: realDoc, error: realErr } = await supabase
        .from('fiscal_documents')
        .select('id, document_type, status, sefaz_status, hub_document_id, emission_id')
        .eq('id', fiscalDocumentId)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (realErr) throw realErr;

      if (realDoc) {
        const failedStatuses = ['error', 'rejected', 'processed_error', 'sent_error', 'sefaz_error', 'status_timeout'];
        const isFailed = failedStatuses.includes(realDoc.status || '') || failedStatuses.includes(realDoc.sefaz_status || '');
        // A RPC confirma que a rejeição é terminal e que não existe chave,
        // protocolo, número ou outro efeito fiscal antes de liberar as notas.
        if (realDoc.document_type !== 'outbound' || !isFailed) {
          throw new Error('Apenas notas com erro de transmissão ou rejeitadas podem ser excluídas. Notas autorizadas devem ser canceladas.');
        }

        const { data: deleted, error: delErr } = await supabase.rpc(
          'delete_failed_cte_attempt_v1' as never,
          { _fiscal_document_id: fiscalDocumentId } as never,
        );

        if (delErr) throw delErr;
        if (!deleted) throw new Error('A tentativa não pôde ser removida porque seu estado mudou. Atualize a página e tente novamente.');
        return true;
      }

      // 2. Se não achou em fiscal_documents, tenta em cte_documents (rascunhos agrupados)
      const { data: draftDoc, error: draftErr } = await supabase
        .from('cte_documents')
        .select('id, fiscal_document_ids')
        .eq('id', fiscalDocumentId)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (draftErr) throw draftErr;

      if (draftDoc) {
        const { data: deleted, error: delErr } = await supabase.rpc('delete_failed_cte_draft_v1', {
          _cte_document_id: fiscalDocumentId,
        });
        if (delErr) throw delErr;
        if (!deleted) throw new Error('O rascunho não pôde ser removido porque seu estado mudou. Atualize a página e tente novamente.');
        return true;
      }

      throw new Error('Documento não encontrado para exclusão.');
    },
    onSuccess: () => {
      toast.success('Tentativa local removida e nota liberada para nova emissão');
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_search'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
    },
    onError: (error: unknown) => {
      toast.error('Falha ao excluir registro', { description: errorMessage(error) });
    }
  });
}
