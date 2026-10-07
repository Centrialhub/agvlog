import { supabase } from '@/integrations/supabase/client';
import { getActiveTenantId } from '@/lib/tenant/activeTenantContext';
import { validateFiscalBlob } from '@/lib/fiscal/fiscalFileValidation';
import type { DriverFiscalFileFormat } from './fiscalCatalog';

const MAX_BYTES = 10_485_760;
export async function downloadDriverFiscalFile(request: {
  tenantId: string; actorId: string; loadId: string; kind: 'cte' | 'nfse'; documentId: string; format: DriverFiscalFileFormat;
}, signal: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const session = await supabase.auth.getSession();
  const token = session.data.session?.access_token;
  if (session.error || !token || session.data.session?.user.id !== request.actorId || getActiveTenantId() !== request.tenantId) {
    throw new Error('Sessão fiscal indisponível.');
  }
  const response = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/driver-fiscal-file', {
    method: 'POST', signal, redirect: 'error', cache: 'no-store', credentials: 'omit',
    headers: {
      Authorization: 'Bearer ' + token, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json', 'x-agvlog-tenant-id': request.tenantId,
    },
    body: JSON.stringify({
      tenant_id: request.tenantId, load_id: request.loadId, kind: request.kind,
      document_id: request.documentId, format: request.format,
    }),
  });
  const expectedType = request.format === 'pdf' ? 'application/pdf' : 'application/xml';
  if (!response.ok || (response.headers.get('Content-Type') || '').split(';')[0].toLowerCase() !== expectedType) {
    throw new Error('Arquivo fiscal indisponível.');
  }
  if (Number(response.headers.get('Content-Length')) > MAX_BYTES) throw new Error('Arquivo fiscal muito grande.');
  const filename = /^attachment; filename="([A-Za-z0-9._-]{1,180})"$/.exec(response.headers.get('Content-Disposition') || '')?.[1];
  if (!filename || !filename.endsWith('.' + request.format)) throw new Error('Arquivo fiscal inválido.');
  const blob = await response.blob();
  if (blob.size > MAX_BYTES) throw new Error('Arquivo fiscal muito grande.');
  await validateFiscalBlob(blob, request.format);
  const current = await supabase.auth.getSession();
  if (signal.aborted || current.error || current.data.session?.access_token !== token
    || current.data.session?.user.id !== request.actorId || getActiveTenantId() !== request.tenantId) {
    throw new Error('Contexto fiscal alterado.');
  }
  return { blob, filename };
}
