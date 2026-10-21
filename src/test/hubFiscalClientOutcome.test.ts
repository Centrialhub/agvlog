import { beforeEach, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));
import { hubFiscal, HubFiscalOperationError } from '@/lib/fiscal/hubFiscalClient';

beforeEach(() => invoke.mockReset());
it('shows the provider error and preserves terminal non-submission on HTTP 502', async () => {
  const response = { success: false, terminal: true, processing: false, requiresReconciliation: false,
    error: { code: 'PROVIDER_SUBMISSION_BLOCKED', message: 'O provedor bloqueou a emissão por licença.',
      submissionOutcome: 'not_submitted', automaticRetry: false } };
  invoke.mockResolvedValue({ data: null, error: { message: 'Edge returned non-2xx',
    context: new Response(JSON.stringify(response), { status: 502 }) } });
  const error = await hubFiscal.get('hub').catch(value => value);
  expect(error).toBeInstanceOf(HubFiscalOperationError);
  expect(error).toMatchObject({ terminal: true, requiresReconciliation: false,
    submissionOutcome: 'not_submitted', automaticRetry: false });
  expect(error.message).toContain('O provedor bloqueou a emissão por licença.');
  expect(invoke).toHaveBeenCalledTimes(1);
});
it('preserves a 202 reconciliation response without treating it as terminal failure', async () => {
  invoke.mockResolvedValue({ data: { success: true, processing: true, terminal: false,
    requiresReconciliation: true, hub: { document: { status: 'provider_unknown' } } }, error: null });
  expect(await hubFiscal.get('hub')).toMatchObject({ terminal: false, requiresReconciliation: true });
});
it('does not infer non-submission from an unavailable transport message', async () => {
  invoke.mockResolvedValue({ data: null, error: { message: 'Serviço indisponível' } });
  expect(await hubFiscal.get('hub').catch(value => value))
    .toMatchObject({ terminal: false, requiresReconciliation: true, automaticRetry: false });
});
