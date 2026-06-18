import { supabase } from '@/integrations/supabase/client';

export type HubDocType = 'nfe' | 'nfce' | 'nfse' | 'cte' | 'mdfe';
export type HubEnvironment = 'sandbox' | 'production';

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
  hub?: { success?: boolean; document?: HubDocument; result?: T; error?: { code: string; message?: string } };
  emission?: { id: string } & Record<string, unknown>;
  error?: { code: string; message?: string };
}

export interface EmitParams {
  type: HubDocType;
  body: {
    emitterCnpj: string;
    environment?: HubEnvironment;
    externalId?: string;
    callbackUrl?: string;
    payload: Record<string, unknown>;
    [k: string]: unknown;
  };
  /** Local linkage so the webhook can mirror status back. */
  fiscalDocumentId?: string;
  cteDocumentId?: string;
  nfseDocumentId?: string;
}

async function invoke(payload: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('hub-fiscal-proxy', { body: payload });
  if (error) throw new Error(error.message || 'Hub Fiscal proxy error');
  return data as HubResponse;
}

export const hubFiscal = {
  emit(params: EmitParams) {
    return invoke({
      action: 'emit',
      type: params.type,
      body: params.body,
      fiscalDocumentId: params.fiscalDocumentId,
      cteDocumentId: params.cteDocumentId,
      nfseDocumentId: params.nfseDocumentId,
    });
  },

  get(hubDocumentId: string, emissionId?: string) {
    return invoke({ action: 'get', id: hubDocumentId, emissionId });
  },

  sync(hubDocumentId: string, emissionId?: string) {
    return invoke({ action: 'sync', id: hubDocumentId, emissionId });
  },

  cancel(hubDocumentId: string, justificativa: string, emissionId?: string) {
    return invoke({
      action: 'cancel', id: hubDocumentId, emissionId,
      body: { justificativa },
    });
  },

  cce(hubDocumentId: string, correcao: string) {
    return invoke({ action: 'cce', id: hubDocumentId, body: { correcao } });
  },

  email(hubDocumentId: string, emails: string[]) {
    return invoke({ action: 'email', id: hubDocumentId, body: { emails } });
  },

  preview(hubDocumentId: string) {
    return invoke({ action: 'preview', id: hubDocumentId });
  },

  query(filters: Record<string, string>) {
    return invoke({ action: 'query', query: filters });
  },

  /** Returns a Blob you can hand to URL.createObjectURL for download/preview. */
  async file(hubDocumentId: string, format: 'pdf' | 'xml' = 'pdf'): Promise<Blob> {
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
      body: JSON.stringify({ action: 'file', id: hubDocumentId, format }),
    });
    if (!res.ok) throw new Error(`Hub file download failed (${res.status})`);
    return await res.blob();
  },
};

export type HubFiscalClient = typeof hubFiscal;