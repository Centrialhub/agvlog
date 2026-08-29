const MAX_POLL_AGE_MS = 15 * 60 * 1000;
const MAX_POLL_ATTEMPTS = 15;
const MAX_MISSING_PROVIDER_ATTEMPTS = 5;

type JsonRecord = Record<string, unknown>;

export type FiscalDocumentScope = 'cte' | 'nfse';
export type FiscalPollOutcome = 'issued' | 'rejected' | 'cancelled' | null;

export interface HubFiscalCredential {
  doc_scope: string;
  environment: string | null;
  secret_name: string | null;
  secret_ciphertext: string | null;
}

interface ResolveHubFiscalTokenInput {
  emitterId: string | null;
  environment?: string | null;
  scope: FiscalDocumentScope;
  defaultToken: string;
  encryptionKey: string;
  getSecret: (name: string) => string | undefined;
}

interface GetHubFiscalDocumentInput {
  baseUrl: string;
  hubDocumentId: string;
  token: string;
  fetcher?: typeof fetch;
}

export interface PollableFiscalDocument {
  id: string;
  tenant_id: string;
  created_at: string;
  status_check_attempts: number | null;
}

interface FiscalPollRpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

interface TerminalizeFiscalPollInput {
  tenantId: string;
  documentKind: 'cte' | 'nfse';
  documentId: string;
  documentNumber: string | null;
  reasonCode: 'missing_provider_reference' | 'provider_unavailable' | 'provider_rate_limited' | 'status_timeout';
  attemptCount: number;
  firstSeenAt: string;
  context: JsonRecord;
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function safeText(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[jwt-redacted]')
    .replace(/(password|senha|token|secret|cookie)\s*[:=]\s*[^,;\s]+/gi, '$1=[redacted]');
  return text.slice(0, maxLength);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function decryptAesGcm(encrypted: string, keyHex: string): Promise<string> {
  const parts = encrypted.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted format');
  const keyBytes = hexToBytes(keyHex.padEnd(64, '0').slice(0, 64));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(parts[2]) },
    key,
    hexToBytes(parts[3]),
  );
  return new TextDecoder().decode(plaintext);
}

export function selectHubFiscalCredential(
  credentials: HubFiscalCredential[],
  scope: FiscalDocumentScope,
  environment?: string | null,
): HubFiscalCredential | null {
  const pick = (candidateScope: string) =>
    credentials.find(credential => credential.doc_scope === candidateScope);
  const pickEnvironment = (candidateScope: string, candidateEnvironment: string) =>
    credentials.find(credential =>
      credential.doc_scope === candidateScope
      && credential.environment === candidateEnvironment,
    );
  const pickUnscoped = (candidateScope: string) =>
    credentials.find(credential =>
      credential.doc_scope === candidateScope
      && !credential.environment,
    );

  if (!environment) return pick(scope) ?? pick('all') ?? null;

  return (
    pickEnvironment(scope, environment)
    ?? pickUnscoped(scope)
    ?? pickEnvironment('all', environment)
    ?? pickUnscoped('all')
    ?? null
  );
}

// deno-lint-ignore no-explicit-any
export async function resolveHubFiscalToken(admin: any, input: ResolveHubFiscalTokenInput): Promise<string> {
  if (!input.emitterId) return input.defaultToken;

  const { data } = await admin
    .from('hub_fiscal_credentials')
    .select('doc_scope, environment, secret_name, secret_ciphertext')
    .eq('emitter_id', input.emitterId)
    .eq('enabled', true);
  const credential = selectHubFiscalCredential(
    (data ?? []) as HubFiscalCredential[],
    input.scope,
    input.environment,
  );

  if (!credential) return input.defaultToken;
  if (credential.secret_ciphertext && input.encryptionKey) {
    try {
      return await decryptAesGcm(credential.secret_ciphertext, input.encryptionKey);
    } catch {
      // Credenciais legadas podem depender do secret_name até serem regravadas.
    }
  }
  if (credential.secret_name) return input.getSecret(credential.secret_name) || input.defaultToken;
  return input.defaultToken;
}

export async function getHubFiscalDocument({
  baseUrl,
  hubDocumentId,
  token,
  fetcher = fetch,
}: GetHubFiscalDocumentInput): Promise<{ status: number; data: unknown }> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/$/, '');
  if (!normalizedBaseUrl) {
    return {
      status: 503,
      data: { error: { code: 'HUB_BASE_URL_MISSING', message: 'HUB_FISCAL_BASE_URL não configurado' } },
    };
  }

  const url = new URL(`${normalizedBaseUrl}/hub_documents_get`);
  url.searchParams.set('id', hubDocumentId);

  try {
    const response = await fetcher(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { parse_error: true };
    }
    return { status: response.status, data };
  } catch (error) {
    const message = (error as Error).message || 'Hub Fiscal indisponível';
    return {
      status: /rate limit|429/i.test(message) ? 429 : 503,
      data: { error: { message } },
    };
  }
}

export function classifyFiscalProviderStatus(rawStatus: string): FiscalPollOutcome {
  const status = rawStatus.toLowerCase();
  if (['authorized', 'autorizado', 'concluido', 'concluído', 'issued', 'emitida'].includes(status)) return 'issued';
  if (['rejected', 'rejeitado', 'rejeitada', 'erro', 'error', 'denied', 'denegado'].includes(status)) return 'rejected';
  if (['cancelled', 'canceled', 'cancelado', 'cancelada'].includes(status)) return 'cancelled';
  return null;
}

export function safeProviderSnapshot(httpStatus: number, payload: unknown): JsonRecord {
  const envelope = asRecord(payload);
  const document = asRecord(envelope.document);
  const rawResponse = asRecord(document.raw_response_json);
  const rawError = asRecord(rawResponse.error);
  const error = asRecord(envelope.error);

  return {
    checked_at: new Date().toISOString(),
    http_status: httpStatus,
    provider_status: safeText(document.status ?? document.plugnotasStatus, 80),
    provider_code: safeText(document.cStat ?? error.code, 80),
    message: safeText(rawError.message ?? rawResponse.message ?? document.message ?? error.message),
  };
}

export function shouldDeadLetter(
  document: PollableFiscalDocument,
  hasProviderReference: boolean,
  now = Date.now(),
): boolean {
  const createdAt = Date.parse(document.created_at);
  const ageExceeded = Number.isFinite(createdAt) && now - createdAt >= MAX_POLL_AGE_MS;
  const attempts = (document.status_check_attempts ?? 0) + 1;
  const attemptLimit = hasProviderReference ? MAX_POLL_ATTEMPTS : MAX_MISSING_PROVIDER_ATTEMPTS;

  return ageExceeded || attempts >= attemptLimit;
}

export async function terminalizeFiscalPoll(
  admin: FiscalPollRpcClient,
  input: TerminalizeFiscalPollInput,
): Promise<void> {
  const { error } = await admin.rpc('terminalize_fiscal_poll_v1', {
    p_tenant_id: input.tenantId,
    p_document_kind: input.documentKind,
    p_document_id: input.documentId,
    p_document_number: input.documentNumber,
    p_reason_code: input.reasonCode,
    p_attempt_count: input.attemptCount,
    p_first_seen_at: input.firstSeenAt,
    p_context: input.context,
  });
  if (error) throw new Error('fiscal_dead_letter_terminalization_failed');
}
