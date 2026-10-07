import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptFiscalCredential } from '../_shared/fiscal-credential-crypto.ts';
import { requireHubEnvironment, selectScopedHubCredential } from '../_shared/fiscal-environment.ts';
import { requireFiscalTransport } from '../_shared/fiscal-transport.ts';
import { FileReadError } from './transport.ts';

/** Called only after the caller RPC has authorized this local document. Never accepts emitter/environment from the browser. */
export async function driverFileCredential(admin: SupabaseClient, request: {
  tenant_id: string; document_id: string; kind: 'cte' | 'nfse';
}, hubId: string, hubBase: string, env: (name: string) => string | undefined): Promise<{ token: string; bindingFingerprint: string }> {
  const fail = () => new FileReadError('FILE_CREDENTIAL_UNAVAILABLE', 503);
  try {
    const { data: local, error: localError } = await admin.from(request.kind === 'cte' ? 'cte_documents' : 'nfse_documents')
      .select('id,tenant_id,emitter_id').eq('id', request.document_id).eq('tenant_id', request.tenant_id).maybeSingle();
    if (localError || local?.id !== request.document_id || local.tenant_id !== request.tenant_id || !local.emitter_id) throw fail();
    const { data: routes, error: routeError } = await admin.from('hub_fiscal_emissions')
      .select('id,emitter_id,environment,doc_type,hub_document_id')
      .eq('tenant_id', request.tenant_id)
      .eq(request.kind === 'cte' ? 'cte_document_id' : 'nfse_document_id', request.document_id)
      .eq('hub_document_id', hubId).eq('doc_type', request.kind).limit(2);
    if (routeError || routes?.length !== 1 || typeof routes[0].id !== 'string' || !routes[0].id
      || routes[0].emitter_id !== local.emitter_id) throw fail();
    const environment = requireHubEnvironment(routes[0].environment);
    const { data: emitter, error: emitterError } = await admin.from('tenant_emitters')
      .select('id').eq('tenant_id', request.tenant_id).eq('id', local.emitter_id).maybeSingle();
    if (emitterError || !emitter) throw fail();
    const { data: credentials, error: credentialError } = await admin.from('hub_fiscal_credentials')
      .select('id,doc_scope,environment,secret_ciphertext,secret_name,enabled')
      .eq('tenant_id', request.tenant_id).eq('emitter_id', local.emitter_id).eq('enabled', true).limit(100);
    if (credentialError || !credentials || credentials.length >= 100) throw fail();
    const credential = selectScopedHubCredential(credentials, request.kind, environment);
    if (!credential || typeof credential.id !== 'string' || !credential.id) throw fail();
    const token = credential.secret_ciphertext
      ? await decryptFiscalCredential(credential.secret_ciphertext, env('AGVLOG_ENCRYPTION_KEY') || '')
      : credential.secret_name ? env(credential.secret_name) || '' : '';
    requireFiscalTransport(hubBase, token);
    // Identity only: never fingerprint plaintext, ciphertext, secret names or native errors.
    const bindingFingerprint = JSON.stringify({
      tenantId: request.tenant_id, kind: request.kind, documentId: local.id,
      emitterId: emitter.id, emissionId: routes[0].id,
      hubDocumentId: routes[0].hub_document_id, documentType: routes[0].doc_type, environment,
      credentialId: credential.id, credentialScope: credential.doc_scope, credentialEnvironment: credential.environment,
    });
    return { token, bindingFingerprint };
  } catch {
    // Native errors can carry secret names, ciphertext or URLs; do not log or return them.
    throw fail();
  }
}
