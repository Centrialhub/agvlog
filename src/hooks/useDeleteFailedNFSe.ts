import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSonnerToast } from '@/hooks/useSonnerToast';
import { useTenant } from './useTenant';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Não foi possível excluir o registro.';
}

/**
 * Exclui um registro de NFS-e que esteja em estado de erro.
 */
export function useDeleteFailedNFSe() {
  const toast = useSonnerToast();
  const qc = useQueryClient();
  const { currentTenant } = useTenant();

  return useMutation({
    mutationFn: async (nfseId: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      // Validamos se a nota realmente está em estado de erro passível de exclusão
      const { data: doc, error: fetchErr } = await supabase
        .from('nfse_documents')
        .select('id, status, tenant_id')
        .eq('id', nfseId)
        .eq('tenant_id', currentTenant.id)
        .single();

      if (fetchErr) throw fetchErr;
      
      const isFailed = doc.status === 'error' || doc.status === 'rejected';
      if (!isFailed) {
        throw new Error('Apenas notas com erro ou rejeitadas podem ser excluídas.');
      }

      // Server guard checks the fiscal outcome before deletion; never release sources from an uncertain document.
      const { error: delErr } = await supabase
        .from('nfse_documents')
        .delete()
        .eq('id', nfseId)
        .eq('tenant_id', currentTenant.id);

      if (delErr) throw delErr;
      return true;
    },
    onSuccess: () => {
      toast.success('Registro de erro removido com sucesso');
      qc.invalidateQueries({ queryKey: ['nfse'] });
      qc.invalidateQueries({ queryKey: ['billing_documents'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
    onError: (error: unknown) => {
      toast.error('Falha ao excluir registro', { description: errorMessage(error) });
    }
  });
}
