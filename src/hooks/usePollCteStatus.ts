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
      
      const res = await hubFiscal.sync(hubDocumentId, emissionId);
      const d: any = res?.hub?.document || {};
      const success = res?.success !== false;

      const update: Record<string, any> = {
        access_key: d.accessKey || undefined,
        sefaz_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
        sefaz_status: d.status || undefined,
        sefaz_status_code: d.cStat != null ? String(d.cStat) : undefined,
        sefaz_message: d.message || undefined,
        status: 
          d.status === 'authorized' ? 'authorized' : 
          d.status === 'cancelled' ? 'cancelled' : 
          d.status === 'rejected' ? 'rejected' : 
          undefined,
      };

      for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];
      
      if (Object.keys(update).length) {
        await supabase.from('fiscal_documents').update(update as any).eq('id', fiscalDocumentId);
      }

      return { success, status: d.status, hub: res };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
      qc.invalidateQueries({ queryKey: ['cte_search'] });
      qc.invalidateQueries({ queryKey: ['cte_monitor'] });
    }
  });
}
