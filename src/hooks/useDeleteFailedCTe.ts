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
      // Validamos se a nota realmente está em estado de erro passível de exclusão
      const { data: doc, error: fetchErr } = await supabase
        .from('fiscal_documents')
        .select('id, sefaz_status, hub_document_id, fiscal_document_ids')
        .eq('id', fiscalDocumentId)
        .single();

      if (fetchErr) throw fetchErr;
      
      // Só permitimos excluir se for erro de SEFAZ e não tiver ID no Hub (ou seja, não foi autorizado)
      // Se tiver hub_document_id, o correto é CANCELAR, não excluir.
      const isFailed = doc.sefaz_status === 'error' || doc.sefaz_status === 'rejected' || doc.sefaz_status === 'processed_error' || doc.sefaz_status === 'sent_error' || doc.sefaz_status === 'sefaz_error';
      if (!isFailed) {
        throw new Error('Apenas notas com erro de transmissão ou rejeitadas podem ser excluídas. Notas autorizadas devem ser canceladas.');
      }

      // Retorna as NFs vinculadas se houver. 
      // Verificamos tanto pelo vínculo direto (cte_emitted_outbound_id) 
      // quanto pelo array de IDs persistido no próprio documento de saída.
      const nfIds = new Set<string>();
      if (doc.fiscal_document_ids?.length) {
        doc.fiscal_document_ids.forEach((id: string) => nfIds.add(id));
      }

      const { error: releaseErr } = await supabase
        .from('fiscal_documents')
        .update({ cte_emitted_at: null, cte_emitted_outbound_id: null } as any)
        .or(`cte_emitted_outbound_id.eq.${fiscalDocumentId}${nfIds.size > 0 ? `,id.in.(${Array.from(nfIds).join(',')})` : ''}`);

      if (releaseErr) console.error('Erro ao liberar NFs vinculadas ao CT-e:', releaseErr);

      const { error: delErr } = await supabase
        .from('fiscal_documents')
        .delete()
        .eq('id', fiscalDocumentId);

      if (delErr) throw delErr;
      return true;
    },
    onSuccess: () => {
      toast.success('Registro de erro removido com sucesso');
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_search'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
    },
    onError: (err: any) => {
      toast.error('Falha ao excluir registro', { description: err.message });
    }
  });
}
