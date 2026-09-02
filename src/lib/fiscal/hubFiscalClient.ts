import { supabase } from '@/integrations/supabase/client';
import { requireHubEnvironment } from '../../../supabase/functions/_shared/fiscal-environment';

export type HubDocType = 'nfe' | 'nfce' | 'nfse' | 'cte' | 'mdfe' | 'nfcom';
/** Environments accepted by the public Hub Fiscal contract. */
export type HubEnvironment = 'sandbox' | 'homologation' | 'production';

export interface HubDocument {
  id?: string;
  idIntegracao?: string;
  status?: string;
  plugnotasStatus?: string;
  plugnotasId?: string;
  accessKey?: string;
  authorizationProtocol?: string;
  plugnotasProtocol?: string;
  number?: string;
  series?: string;
  cStat?: number;
  message?: string;
  pdfUrl?: string;
  xmlUrl?: string;
  [k: string]: unknown;
}

export interface HubResponse<T = unknown> {
  success: boolean;
  source?: string;
  scope_matched?: string | null;
  hub?: {
    success?: boolean;
    document?: HubDocument;
    result?: T;
    code?: string;
    message?: string;
    error?: { code: string; message?: string; retryable?: boolean };
  };
  emission?: { id: string } & Record<string, unknown>;
  error?: { code: string; message?: string };
}

export interface EmitParams {
  type: HubDocType;
  body: {
    emitterCnpj: string;
    environment: HubEnvironment;
    externalId?: string;
    callbackUrl?: string;
    payload: Record<string, unknown>;
    [k: string]: unknown;
  };
  /** Local linkage so the webhook can mirror status back. */
  fiscalDocumentId?: string;
  cteDocumentId?: string;
  nfseDocumentId?: string;
  loadManifestId?: string;
  /** Tenant emitter id — routes the call to the correct Hub Fiscal token. */
  emitterId?: string;
}

export function readHubFiscalError(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const messages = value.map(readHubFiscalError).filter((message): message is string => Boolean(message));
    return messages.length ? messages.join(' | ') : null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  const messageKeys = ['message', 'mensagem', 'detail', 'erro'] as const;
  const message = messageKeys
    .map(key => typeof record[key] === 'string' ? String(record[key]).trim() : '')
    .find(Boolean) || '';
  if (code || message) return [code, message].filter(Boolean).join(': ');

  for (const key of ['error', 'errors', 'hub', 'details']) {
    const nested = readHubFiscalError(record[key]);
    if (nested) return nested;
  }
  return null;
}

async function invoke(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('hub-fiscal-proxy', { body: payload });
  if (error) {
    let detail = error.message || 'Hub Fiscal proxy error';
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const response = await context.clone().json();
        detail = readHubFiscalError(response) || detail;
      } catch { /* mantém a mensagem padrão */ }
    }
    throw new Error(detail);
  }
  if ((data as HubResponse | null)?.success === false) {
    throw new Error(readHubFiscalError(data) || 'Operação recusada pelo Hub Fiscal');
  }
  return data as HubResponse;
}

export const hubFiscal = {
  emit(params: EmitParams) {
    return invoke({
      action: 'emit',
      type: params.type,
      body: { ...params.body, environment: requireHubEnvironment(params.body.environment) },
      fiscalDocumentId: params.fiscalDocumentId,
      cteDocumentId: params.cteDocumentId,
      nfseDocumentId: params.nfseDocumentId,
      loadManifestId: params.loadManifestId,
      emitterId: params.emitterId,
    });
  },

  get(hubDocumentId: string, emissionId?: string) {
    return invoke({ action: 'get', id: hubDocumentId, emissionId });
  },

  sync(
    hubDocumentId: string,
    emissionId?: string,
    fiscalDocumentId?: string,
    opts: { type?: HubDocType; emitterId?: string | null } = {},
  ) {
    return invoke({
      action: 'sync', id: hubDocumentId, emissionId, fiscalDocumentId,
      type: opts.type, emitterId: opts.emitterId || undefined,
    });
  },

  cancel(hubDocumentId: string, justificativa: string, emissionId?: string, fiscalDocumentId?: string) {
    return invoke({
      action: 'cancel', id: hubDocumentId, emissionId,
      fiscalDocumentId,
      body: { justificativa },
    });
  },

  closeMdfe(hubDocumentId: string, loadManifestId: string, emissionId: string, emitterId?: string | null) {
    return invoke({
      action: 'close-mdfe',
      type: 'mdfe',
      id: hubDocumentId,
      loadManifestId,
      emissionId,
      emitterId: emitterId || undefined,
    });
  },
  
  cancelNFSe(hubDocumentId: string, justificativa: string, emissionId?: string) {
    return invoke({
      action: 'cancel-nfse',
      id: hubDocumentId,
      emissionId,
      body: { justificativa },
    });
  },

  cce(hubDocumentId: string, correcao: string) {
    return invoke({ action: 'cce', id: hubDocumentId, body: { correcao } });
  },

  email(hubDocumentId: string, emails: string[]) {
    return invoke({ action: 'email', id: hubDocumentId, body: { destinatarios: emails } });
  },

  preview(hubDocumentId: string) {
    return invoke({ action: 'preview', id: hubDocumentId });
  },

  /**
   * Solicita PDF/XML SOB DEMANDA (POST /hub_documents_deliver). O Hub gera/baixa o
   * arquivo no provedor no momento do pedido — não depende de cache.
   */
  deliver(hubDocumentId: string, opts: {
    kinds?: ('pdf' | 'xml')[];
    mode?: 'url' | 'inline' | 'email' | 'callback';
    expiresIn?: number;
    forceRefresh?: boolean;
    type?: HubDocType;
    emitterId?: string | null;
    emissionId?: string | null;
    /** CT-e: variante do arquivo (XML/PDF do evento). */
    documento?: 'Cancelamento' | 'CCe';
  } = {}) {
    return invoke({
      action: 'deliver',
      id: hubDocumentId,
      type: opts.type,
      emitterId: opts.emitterId || undefined,
      emissionId: opts.emissionId || undefined,
      kinds: opts.kinds ?? ['pdf', 'xml'],
      documento: opts.documento,
      mode: opts.mode ?? 'url',
      expiresIn: opts.expiresIn ?? 604800,
      forceRefresh: opts.forceRefresh ?? true,
    });
  },

  /** URLs assinadas de PDF/XML (GET /hub_documents_links). */
  links(hubDocumentId: string, opts: {
    expiresIn?: number; type?: HubDocType; emitterId?: string | null;
    documento?: 'Cancelamento' | 'CCe';
  } = {}) {
    return invoke({
      action: 'links',
      id: hubDocumentId,
      type: opts.type,
      emitterId: opts.emitterId || undefined,
      documento: opts.documento,
      expiresIn: opts.expiresIn ?? 604800,
    });
  },

  query(filters: Record<string, string>, emitterId: string, environment: HubEnvironment) {
    return invoke({ action: 'query', query: filters, emitterId, environment: requireHubEnvironment(environment, filters.environment) });
  },

  /** CT-e — Desacordo do Tomador (mín. 15 caracteres). */
  desacordo(hubDocumentId: string, justificativa: string, emissionId?: string) {
    return invoke({ action: 'desacordo', id: hubDocumentId, emissionId, body: { justificativa } });
  },

  /** CT-e — Comprovante de Entrega (CE-CT-e). */
  cent(hubDocumentId: string, body: {
    dataHoraEntrega: string;
    nomeRecebedor: string;
    cpfRecebedor: string;
    hashComprovante: string;
  }, emissionId?: string) {
    return invoke({ action: 'cent', id: hubDocumentId, emissionId, body });
  },

  /** CT-e — Descarta rejeitado no ManagerSaaS permitindo reemissão com mesma numeração. */
  discard(hubDocumentId: string, emissionId?: string) {
    return invoke({ action: 'discard', id: hubDocumentId, emissionId });
  },

  /** CT-e — Importa XML autorizado externamente. */
  import(body: { emitterCnpj: string; environment: HubEnvironment; xmlBase64: string }, emitterId?: string) {
    return invoke({ action: 'import', body: { ...body, environment: requireHubEnvironment(body.environment) }, emitterId });
  },

  /** Diagnóstico: verifica qual credencial seria usada para um emitente/escopo. Não retorna o token. */
  ping(emitterId: string, type: HubDocType | 'all', environment: HubEnvironment) {
    return invoke({ action: 'ping', emitterId, type, environment: requireHubEnvironment(environment) });
  },

  /** Returns a Blob you can hand to URL.createObjectURL for download/preview. */
  async file(
    hubDocumentId: string,
    format: 'pdf' | 'xml' | 'cancel_xml' = 'pdf',
    opts: {
      type?: HubDocType; emitterId?: string | null; emissionId?: string | null;
      documento?: 'Cancelamento' | 'CCe';
    } = {},
  ): Promise<Blob> {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/hub-fiscal-proxy`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
      },
      body: JSON.stringify({
        action: 'file',
        id: hubDocumentId,
        format,
        documento: opts.documento,
        type: opts.type,
        emitterId: opts.emitterId || undefined,
        emissionId: opts.emissionId || undefined,
      }),
    });
    const contentType = res.headers.get('Content-Type') || '';
    if (!res.ok || contentType.includes('application/json')) {
      let message = `Hub Fiscal retornou ${res.status}`;
      try {
        const j = await res.json();
        message = j?.error?.message || j?.error?.code || j?.message || message;
      } catch { /* keep default */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    if (blob.size === 0) throw new Error('Arquivo vazio retornado pelo Hub Fiscal.');
    return blob;
  },
};

export type HubFiscalClient = typeof hubFiscal;
