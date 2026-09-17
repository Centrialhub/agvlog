import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import {
  parsePortalFiscalBundle,
  type PortalFiscalDocument,
  type PortalFiscalFileFormat,
} from '@/lib/portal/portalFiscalBundle';
import { downloadPortalFile } from '@/lib/portal/downloadPortalFile';

export function usePortalFiscalBundle(fiscalDocumentId?: string) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const actorId = user?.id;
  const tenantId = currentTenant?.id;

  return useQuery({
    queryKey: ['portal_fiscal_bundle', tenantId, actorId, fiscalDocumentId],
    queryFn: async ({ signal }) => {
      if (!tenantId || !actorId || !fiscalDocumentId) {
        throw new Error('Selecione a empresa e entre com uma sessão válida.');
      }
      const { data, error } = await supabase.rpc('portal_list_fiscal_bundle', {
        _tenant_id: tenantId,
        _fiscal_document_id: fiscalDocumentId,
      }).abortSignal(signal);
      if (error) throw error;
      return parsePortalFiscalBundle(data, { tenantId, actorId, documentId: fiscalDocumentId });
    },
    enabled: !!tenantId && !!actorId && !!fiscalDocumentId,
    staleTime: 30_000,
  });
}

export function useDownloadPortalFiscalFile(fiscalDocumentId?: string) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const actorId = user?.id;
  const tenantId = currentTenant?.id;

  return useMutation({
    mutationFn: async ({
      document,
      format,
    }: {
      document: PortalFiscalDocument;
      format: PortalFiscalFileFormat;
    }) => {
      if (!tenantId || !actorId || !fiscalDocumentId) {
        throw new Error('Selecione a empresa e entre com uma sessão válida.');
      }
      return downloadPortalFile({
        tenant_id: tenantId,
        resource_type: document.kind,
        resource_id: document.id,
        parent_id: fiscalDocumentId,
        format,
        fallbackFilename: `${document.kind}-${document.number || document.id}.${format}`,
      });
    },
  });
}
