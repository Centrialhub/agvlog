export const HUB_ENVIRONMENTS = ['sandbox', 'homologation', 'production'] as const;
export type HubEnvironment = typeof HUB_ENVIRONMENTS[number];
export const HUB_DOCUMENT_SCOPES = ['all', 'nfse', 'cte', 'nfe', 'nfce', 'mdfe', 'nfcom'] as const;
export type HubDocumentScope = typeof HUB_DOCUMENT_SCOPES[number];

export class FiscalCredentialError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FiscalCredentialError';
  }
}

export function requireHubEnvironment(...candidates: unknown[]): HubEnvironment {
  const supplied = candidates.filter(value => value !== undefined && value !== null);
  if (!supplied.length) throw new FiscalCredentialError('HUB_CREDENTIAL_ENVIRONMENT_REQUIRED', 'Informe explicitamente o ambiente fiscal.');
  if (supplied.some(value => !HUB_ENVIRONMENTS.includes(value as HubEnvironment))) {
    throw new FiscalCredentialError('HUB_CREDENTIAL_ENVIRONMENT_INVALID', 'Ambiente fiscal inválido.');
  }
  if (new Set(supplied).size !== 1) {
    throw new FiscalCredentialError('HUB_CREDENTIAL_ENVIRONMENT_MISMATCH', 'O ambiente solicitado difere do documento ou da configuração informada.');
  }
  return supplied[0] as HubEnvironment;
}

export function requireHubDocumentScope(value: unknown): HubDocumentScope {
  if (!HUB_DOCUMENT_SCOPES.includes(value as HubDocumentScope)) {
    throw new FiscalCredentialError('HUB_CREDENTIAL_SCOPE_INVALID', 'Escopo fiscal inválido.');
  }
  return value as HubDocumentScope;
}

type ScopedCredential = { doc_scope: string; environment: string | null; enabled?: boolean };

export function selectScopedHubCredential<T extends ScopedCredential>(
  credentials: readonly T[], scope: string, environment: HubEnvironment,
): T | null {
  requireHubDocumentScope(scope);
  requireHubEnvironment(environment);
  const eligible = credentials.filter(item => item.enabled !== false && item.environment === environment);
  for (const candidateScope of scope === 'all' ? ['all'] : [scope, 'all']) {
    const matches = eligible.filter(item => item.doc_scope === candidateScope);
    if (matches.length > 1) throw new FiscalCredentialError('HUB_CREDENTIAL_AMBIGUOUS', 'Mais de uma credencial habilitada para o mesmo escopo e ambiente.');
    if (matches.length === 1) return matches[0];
  }
  return null;
}
