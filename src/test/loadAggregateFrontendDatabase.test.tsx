import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadAggregateCommand } from '@/hooks/useLoadAggregateCommand';
import { pendingLoadAggregateCommand } from '@/lib/loads/loadAggregateOutbox';
import { applyLoadCommand, createLoadAggregateDatabase, loadAggregateIds as i } from './helpers/loadAggregateDatabase';

vi.hoisted(async () => {
  const { Blob, File } = await import('node:buffer');
  vi.stubGlobal('Blob', Blob); vi.stubGlobal('File', File);
});

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), tenant: '', actor: '', lostReplies: 0, delay: false,
  release: null as null | (() => void),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));

let db: PGlite;
let client: QueryClient;
let transport: Promise<unknown> = Promise.resolve();

beforeAll(async () => { db = await createLoadAggregateDatabase(); }, 40_000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
  localStorage.clear(); vi.clearAllMocks();
  mock.tenant = i.tenant; mock.actor = i.operator; mock.lostReplies = 0; mock.delay = false; mock.release = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  Object.defineProperty(navigator, 'locks', {
    configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() },
  });
  mock.rpc.mockImplementation((name: string, args: { _payload: unknown }) => {
    let pending: Promise<unknown> | undefined;
    const run = () => {
      if (pending) return pending;
      const work = async () => {
        try {
          if (name !== 'apply_load_aggregate_command') throw new Error(`Unexpected RPC ${name}`);
          if (mock.delay) { mock.delay = false; await new Promise<void>(resolve => { mock.release = resolve; }); }
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [mock.actor]);
          const data = await applyLoadCommand(db, args._payload);
          if (mock.lostReplies > 0) {
            mock.lostReplies -= 1;
            return { data: null, error: { message: 'Resposta perdida após confirmação no banco' } };
          }
          return { data, error: null };
        } catch (error) { return { data: null, error }; }
      };
      pending = transport.then(work, work); transport = pending; return pending;
    };
    return {
      abortSignal: run,
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => run().then(resolve, reject),
    };
  });
});
afterEach(async () => {
  mock.release?.(); cleanup(); client.clear(); await transport; await db.exec('rollback;reset role'); localStorage.clear();
});

function Harness() {
  const command = useLoadAggregateCommand();
  const [message, setMessage] = useState('');
  const submit = async () => {
    try {
      const result = await command.submit({ action: 'create', changes: { destination: 'Cliente React QA' } });
      setMessage(`ok:${'load_id' in result ? result.load_id : ''}`);
    } catch (error) { setMessage((error as Error).message); }
  };
  const recover = async () => {
    try {
      const result = await command.recover();
      setMessage(`recovered:${'load_id' in result ? result.load_id : ''}`);
    } catch (error) { setMessage((error as Error).message); }
  };
  return <div>
    <button type="button" onClick={submit} disabled={command.isPending || !!command.pending || !!command.recoveryError}>
      {command.isPending ? 'Salvando…' : 'Criar carga'}
    </button>
    <button type="button" onClick={recover} disabled={command.isPending || !command.pending || !!command.recoveryError}>Recuperar carga</button>
    {command.pending && <span>Alteração sem confirmação</span>}
    {command.recoveryError && <div role="alert">{command.recoveryError}</div>}
    <output>{message}</output>
  </div>;
}
const renderHarness = () => render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);

describe('load aggregate frontend backed by the real SQL command', { timeout: 15_000 }, () => {
  it('uses only the canonical RPC and accepts a compatible confirmation', async () => {
    renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Criar carga' }));
    await waitFor(() => expect(screen.getByText(/^ok:/)).toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls[0][0]).toBe('apply_load_aggregate_command');
    expect((await db.query('select count(*)::int n from private.load_aggregate_commands')).rows[0]).toEqual({ n: 1 });
  });

  it('automatically replays a lost acknowledgement with the exact same request UUID', async () => {
    mock.lostReplies = 1; renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Criar carga' }));
    await waitFor(() => expect(screen.getByText(/^ok:/)).toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(2);
    const requests = mock.rpc.mock.calls.map(([, args]) => args._payload.request_id);
    expect(requests[0]).toBe(requests[1]);
    expect((await db.query('select count(*)::int n from private.load_aggregate_commands')).rows[0]).toEqual({ n: 1 });
    expect(pendingLoadAggregateCommand(localStorage, i.tenant, i.operator)).toBeNull();
  });

  it('keeps an uncertain command after both automatic attempts and recovers it later', async () => {
    mock.lostReplies = 2; renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Criar carga' }));
    await screen.findByText('Resposta perdida após confirmação no banco');
    const request = pendingLoadAggregateCommand(localStorage, i.tenant, i.operator)!.payload.request_id;
    expect(screen.getByRole('button', { name: 'Criar carga' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar carga' }));
    await waitFor(() => expect(screen.getByText(/^recovered:/)).toBeInTheDocument());
    expect(mock.rpc.mock.calls.map(([, args]) => args._payload.request_id)).toEqual([request, request, request]);
    expect(pendingLoadAggregateCommand(localStorage, i.tenant, i.operator)).toBeNull();
  });

  it('disables duplicate submission while the command is in flight', async () => {
    mock.delay = true; renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Criar carga' }));
    expect(await screen.findByRole('button', { name: 'Salvando…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Salvando…' }));
    expect(mock.rpc).toHaveBeenCalledTimes(1); mock.release?.();
    await waitFor(() => expect(screen.getByText(/^ok:/)).toBeInTheDocument());
  });

  it('fails closed when the durable outbox is incompatible', () => {
    localStorage.setItem(`agvlog:load-aggregate:v0:${i.tenant}:${i.operator}`, '{}');
    renderHarness();
    expect(screen.getByRole('alert')).toHaveTextContent('Recuperação da alteração de carga indisponível');
    expect(screen.getByRole('button', { name: 'Criar carga' })).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
