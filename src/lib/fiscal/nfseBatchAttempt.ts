import { PRODUCTION_HUB_ENVIRONMENT, type HubEnvironment } from '../../../supabase/functions/_shared/fiscal-environment';

export interface BatchAttempt {
  schemaVersion: 2;
  mode: 'individual' | 'unified';
  requestId: string;
  environment: HubEnvironment;
  sourceCount: number;
  drafts: Record<string, { nfseDocumentId: string; label: string }>;
}

export function isStoredBatchAttempt(value: unknown): value is BatchAttempt {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Partial<BatchAttempt>;
  if (attempt.schemaVersion !== 2 ||
    !['individual', 'unified'].includes(String(attempt.mode)) ||
    attempt.environment !== PRODUCTION_HUB_ENVIRONMENT ||
    typeof attempt.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(attempt.requestId) ||
    !Number.isInteger(attempt.sourceCount) || Number(attempt.sourceCount) < 1 ||
    !attempt.drafts || typeof attempt.drafts !== 'object') return false;
  const drafts = Object.values(attempt.drafts);
  return drafts.length > 0 && drafts.every(draft =>
    Boolean(draft) && typeof draft.nfseDocumentId === 'string' && /^[0-9a-f-]{36}$/i.test(draft.nfseDocumentId) &&
    typeof draft.label === 'string' && draft.label.length <= 500,
  );
}
