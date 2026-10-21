import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useResendCte, useSyncCTe } from '@/hooks/useIssueCTe';

const mock = vi.hoisted(() => ({ invoke: vi.fn(), persisted: 'provider_unknown' }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ error: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mock.invoke },
  from: () => {
    const builder = {
      select: () => builder, eq: () => builder, or: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: async () => ({ error: null, data: {
        id: 'local', hub_document_id: 'hub', emission_id: 'emission', emitter_id: 'emitter',
        fiscal_document_id: 'local', environment: 'homologation',
        request_payload: { emitterCnpj: '11222333000181', environment: 'homologation', payload: {} },
      } }),
    };
    return builder;
  },
} }));
let client: QueryClient;
beforeEach(() => {
  mock.invoke.mockReset();
  mock.persisted = 'provider_unknown';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

function Story({ recover }: { recover: boolean }) {
  const sync = useSyncCTe();
  const resend = useResendCte();
  const operation = recover ? resend : sync;
  const monitor = useQuery({ queryKey: ['cte_monitor'], queryFn: async () => mock.persisted });
  return <><div data-testid="status">{monitor.data}</div>
    <button onClick={() => operation.mutate('local')}>Consultar operação</button>
    {operation.isError && <div role="alert">{operation.error.message}</div>}</>;
}

it.each([
  [false, 502, 'error'], [true, 502, 'error'],
  [false, 422, 'rejected'], [true, 422, 'rejected'],
] as const)('refreshes visible persisted state after recovery=%s HTTP %s', async (recover, http, status) => {
  mock.invoke.mockImplementation(async () => {
    mock.persisted = status;
    return { data: null, error: { message: 'Edge non-2xx', context: new Response(JSON.stringify({
      success: false, processing: false, terminal: true, requiresReconciliation: false,
      error: { code: status === 'error' ? 'PROVIDER_SUBMISSION_BLOCKED' : 'FISCAL_DOCUMENT_REJECTED',
        message: 'Falha fiscal confirmada.', automaticRetry: false,
        ...(status === 'error' ? { submissionOutcome: 'not_submitted' } : {}) },
    }), { status: http }) } };
  });
  render(<QueryClientProvider client={client}><Story recover={recover} /></QueryClientProvider>);
  expect(await screen.findByText('provider_unknown')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha fiscal confirmada.');
  expect(await screen.findByText(status)).toBeInTheDocument();
  expect(mock.invoke).toHaveBeenCalledTimes(1);
});
