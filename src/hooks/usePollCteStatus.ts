import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import { toast } from 'sonner';

/**
 * Hook para gerenciar o polling de documentos em estados transitórios no Hub Fiscal.
 * Se um documento estiver em 'cancelling', ele deve ser sincronizado até que o status mude.
 */
export function usePollCteStatus() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: { hubDocumentId: string; emissionId?: string; fiscalDocumentId: string }) => {
      const { hubDocumentId, emissionId, fiscalDocumentId } = args;
      
      // O sync no proxy já atualiza fiscal_documents agora
      const res = await hubFiscal.sync(hubDocumentId, emissionId, fiscalDocumentId);
      const d: any = res?.hub?.document || {};
      const success = res?.success !== false;

      return { success, status: d.status, hub: res };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_search'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
    }
  });
}
