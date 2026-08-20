// guardrail:allow-direct-write
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';

/**
 * Exclui um registro de CT-e que esteja em estado de erro (sefaz-error).
 * Isso serve para "limpar" a visualização de tentativas que falharam antes mesmo de gerar um hub_document_id.
 */
export function useDeleteFailedCTe() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (fiscalDocumentId: string) => {
      // 1. Tenta buscar em fiscal_documents (emissões reais/tentativas no Hub)
      const { data: realDoc, error: realErr } = await supabase
        // linter:allow-direct-write fiscal_documents legacy-code 2026-12-31
      .from('fiscal_documents')
        .select('id, sefaz_status, hub_document_id')
        .eq('id', fiscalDocumentId)
        .maybeSingle();

      if (realDoc) {
        // Só permitimos excluir se for erro de SEFAZ e não tiver ID no Hub (ou seja, não foi autorizado)
        const isFailed = ['error', 'rejected', 'processed_error', 'sent_error', 'sefaz_error'].includes(realDoc.sefaz_status || '');
        if (!isFailed && realDoc.hub_document_id) {
          throw new Error('Apenas notas com erro de transmissão ou rejeitadas podem ser excluídas. Notas autorizadas devem ser canceladas.');
        }

        // Libera as NFs vinculadas a este outbound_id
        const { error: releaseErr } = await supabase
          // linter:allow-direct-write fiscal_documents legacy-code 2026-12-31
      .from('fiscal_documents')
          .update({ cte_emitted_at: null, cte_emitted_outbound_id: null } as any)
          .eq('cte_emitted_outbound_id', fiscalDocumentId)
          .is('deleted_at', null);

        if (releaseErr) console.error('Erro ao liberar NFs vinculadas ao CT-e (real):', releaseErr);

        const { error: delErr } = await supabase
          // linter:allow-direct-write fiscal_documents legacy-code 2026-12-31
      .from('fiscal_documents')
          .delete()
          .eq('id', fiscalDocumentId);

        if (delErr) throw delErr;
        return true;
      }

      // 2. Se não achou em fiscal_documents, tenta em cte_documents (rascunhos agrupados)
      const { data: draftDoc, error: draftErr } = await supabase
        .from('cte_documents')
        .select('id, fiscal_document_ids')
        .eq('id', fiscalDocumentId)
        .maybeSingle();

      if (draftDoc) {
        // Libera as NFs cujos IDs estão no array do rascunho
        if (draftDoc.fiscal_document_ids && Array.isArray(draftDoc.fiscal_document_ids)) {
          const ids = draftDoc.fiscal_document_ids.filter(Boolean);
          if (ids.length > 0) {
            const { error: releaseErr } = await supabase
              // linter:allow-direct-write fiscal_documents legacy-code 2026-12-31
      .from('fiscal_documents')
            .update({ cte_emitted_at: null, cte_emitted_outbound_id: null } as any)
            .in('id', ids)
            .is('deleted_at', null);
            
            if (releaseErr) console.error('Erro ao liberar NFs vinculadas ao rascunho:', releaseErr);
          }
        }

        const { error: delErr } = await supabase
          .from('cte_documents')
          .delete()
          .eq('id', fiscalDocumentId);

        if (delErr) throw delErr;
        return true;
      }

      throw new Error('Documento não encontrado para exclusão.');
    },
    onSuccess: () => {
      toast.success('Registro de erro removido com sucesso');
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_search'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
    },
    onError: (err: any) => {
      toast.error('Falha ao excluir registro', { description: err.message });
    }
  });
}
