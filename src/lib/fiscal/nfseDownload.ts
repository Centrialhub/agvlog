import { supabase } from '@/integrations/supabase/client';
import { getActiveTenantId } from '@/lib/tenant/activeTenantContext';

const SESSION_REQUIRED = 'Sua sessão expirou. Entre novamente e repita o download das NFS-e. Não é necessário emitir as notas novamente.';

export function nfseDownloadErrorMessage(error: unknown): string {
  const value = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; status?: unknown } : null;
  if (value?.status === 401 || ['PGRST301', 'PGRST303'].includes(String(value?.code)) || /jwt.*expired|refresh.token|session.*expired/i.test(String(value?.message ?? ''))) return SESSION_REQUIRED;
  if (typeof value?.message === 'string' && value.message.trim()) return value.message;
  return typeof error === 'string' && error.trim() ? error : 'Não foi possível baixar os arquivos. Tente novamente.';
}

let refreshPending: ReturnType<typeof supabase.auth.refreshSession> | null = null;
async function refreshDownloadSession() {
  const pending = refreshPending ??= supabase.auth.refreshSession();
  try { return await pending; }
  finally { if (refreshPending === pending) refreshPending = null; }
}

/** Only retries the read of file references, never a fiscal submission. */
export async function fetchNfseHubRefs(ids: string[]) {
  const refs = new Map<string, { hubDocumentId: string; emissionId: string }>();
  if (!ids.length) return refs;
  const tenant = getActiveTenantId();
  if (!tenant) throw new Error('Selecione a empresa novamente antes de baixar as NFS-e.');
  const initial = await supabase.auth.getSession();
  if (initial.error || !initial.data.session) throw new Error(SESSION_REQUIRED);
  const userId = initial.data.session.user.id;
  const assertContext = async () => {
    const current = await supabase.auth.getSession();
    if (current.error || !current.data.session) throw new Error(SESSION_REQUIRED);
    if (getActiveTenantId() !== tenant || current.data.session.user.id !== userId) {
      throw new Error('A empresa ou a sessão mudou. Selecione as NFS-e novamente para baixar.');
    }
  };
  let refreshed = false;
  for (let i = 0; i < ids.length; i += 200) {
    await assertContext();
    const query = () => supabase.from('hub_fiscal_emissions')
      .select('id, hub_document_id, nfse_document_id, created_at')
      .eq('tenant_id', tenant).in('nfse_document_id', ids.slice(i, i + 200))
      .order('created_at', { ascending: true });
    let result = await query();
    if (result.status === 401 && !refreshed) {
      refreshed = true;
      const refresh = await refreshDownloadSession();
      if (refresh.error || !refresh.data.session) throw new Error(SESSION_REQUIRED);
      await assertContext();
      result = await query();
    }
    await assertContext();
    if (result.error) throw new Error(nfseDownloadErrorMessage({ ...result.error, status: result.status }));
    for (const row of result.data ?? []) {
      if (row.hub_document_id && row.nfse_document_id) {
        refs.set(row.nfse_document_id, { hubDocumentId: row.hub_document_id, emissionId: row.id });
      }
    }
  }
  return refs;
}
