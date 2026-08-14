import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/sonner';

/**
 * Exclui um registro de NFS-e que esteja em estado de erro.
 */
export function useDeleteFailedNFSe() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (nfseId: string) => {
      // Validamos se a nota realmente está em estado de erro passível de exclusão
      const { data: doc, error: fetchErr } = await (supabase as any)
        .from('nfse_documents')
        .select('id, status, tenant_id')
        .eq('id', nfseId)
        .single();

      if (fetchErr) throw fetchErr;
      
      const isFailed = doc.status === 'error' || doc.status === 'rejected';
      if (!isFailed) {
        throw new Error('Apenas notas com erro ou rejeitadas podem ser excluídas.');
      }

      // Retorna as NFs vinculadas
      const { error: releaseErr } = await (supabase as any)
        .from('fiscal_documents')
        .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
        .eq('nfse_emitted_document_id', nfseId)
        .eq('tenant_id', doc.tenant_id);

      if (releaseErr) console.error('Erro ao liberar NFs vinculadas:', releaseErr);

      const { error: delErr } = await (supabase as any)
        .from('nfse_documents')
        .delete()
        .eq('id', nfseId);

      if (delErr) throw delErr;
      return true;
    },
    onSuccess: () => {
      toast.success('Registro de erro removido com sucesso e NFs liberadas');
      qc.invalidateQueries({ queryKey: ['nfse'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
    onError: (err: any) => {
      toast.error('Falha ao excluir registro', { description: err.message });
    }
  });
}
