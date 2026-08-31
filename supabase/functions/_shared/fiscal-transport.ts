// Public API endpoint supplied by the operator; secrets remain server-side.
const DEFAULT_HUB_BASE_URL = 'https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1';
export function fiscalHubBaseUrl(configured: string | undefined): string {
  return (configured?.trim() || DEFAULT_HUB_BASE_URL).replace(/\/$/, '');
}
export class FiscalTransportConfigurationError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'FiscalTransportConfigurationError'; }
}
export function inspectFiscalTransport(baseUrl: string, token: string) {
  let normalizedBase: string | null = null;
  try {
    const url = new URL(baseUrl.trim());
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) normalizedBase = url.toString().replace(/\/$/, '');
  } catch { /* Return only configuration status, never an invalid raw value. */ }
  let credentialHeaderValid = false;
  if (token) {
    try { new Headers({ Authorization: 'Bearer ' + token }); credentialHeaderValid = true; } catch { /* Do not return the token or native error. */ }
  }
  return { baseConfigured: !!baseUrl.trim(), baseValid: normalizedBase !== null, baseUrl: normalizedBase, credentialReadable: !!token, credentialHeaderValid };
}
export function requireFiscalTransport(baseUrl: string, token: string): string {
  const state = inspectFiscalTransport(baseUrl, token);
  if (!state.baseConfigured) throw new FiscalTransportConfigurationError('HUB_BASE_URL_MISSING', 'O endereço da API do Hub Fiscal não está configurado no AGV Log (HUB_FISCAL_BASE_URL).');
  if (!state.baseValid) throw new FiscalTransportConfigurationError('HUB_BASE_URL_INVALID', 'O endereço da API do Hub Fiscal deve ser HTTPS, sem credenciais, parâmetros ou fragmento.');
  if (!state.credentialReadable) throw new FiscalTransportConfigurationError('HUB_CREDENTIAL_UNAVAILABLE', 'Credencial do emitente indisponível.');
  if (!state.credentialHeaderValid) throw new FiscalTransportConfigurationError('HUB_CREDENTIAL_HEADER_INVALID', 'O token contém caracteres inválidos para autenticação HTTP. Recadastre o token sem quebras de linha.');
  return state.baseUrl!;
}

/** Read-only lookup of one persisted integration reference. Never issues documents. */
export async function lookupFiscalOperation(baseUrl: string, token: string, reference: string, environment: string) {
  const base = requireFiscalTransport(baseUrl, token);
  const url = new URL(base + '/hub_documents_query');
  url.searchParams.set('idIntegracao', reference);
  url.searchParams.set('environment', environment);
  url.searchParams.set('type', 'cte');
  const response = await fetch(url, { method: 'GET', headers: { Authorization: 'Bearer ' + token, 'X-HubFiscal-Api-Version': '2026-08-27' } });
  const data = await response.json().catch(() => null);
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const nested = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? obj.data as Record<string, unknown> : {};
  const candidate = [data, obj.documents, obj.items, obj.data, nested.documents, nested.items].find(Array.isArray);
  const rows = (candidate || (obj.document ? [obj.document] : [])) as unknown[];
  const error = obj.error && typeof obj.error === 'object' ? obj.error as Record<string, unknown> : {};
  const errorCode = typeof error.code === 'string' && /^[A-Z0-9_.-]{1,80}$/.test(error.code) ? error.code : null;
  const matches = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' &&
    [(row as Record<string, unknown>).idIntegracao, (row as Record<string, unknown>).externalId].includes(reference));
  const safeText = (value: unknown) => typeof value === 'string' ? value.slice(0, 160) : null;
  return { httpStatus: response.status, providerSuccess: obj.success === true, errorCode,
    responseKeys: Object.keys(obj).slice(0, 20), dataKeys: Object.keys(nested).slice(0, 20), recordsReturned: rows.length,
    // Only exact-reference matches are returned. No fiscal payload, customer or token.
    matches: matches.map(row => ({ id: safeText(row.id), status: safeText(row.status), environment: safeText(row.environment), idIntegracao: safeText(row.idIntegracao), externalId: safeText(row.externalId) })) };
}
