import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoadImportCommand } from '@/hooks/useLoadImportCommand';
import { pendingLoadImportCommand } from '@/lib/loadImports/loadImportOutbox';
import type { LoadImportCommandInput } from '@/lib/loadImports/loadImportCommands';
import {
  applyLoadImport, createLoadImportDatabase, loadImportIds as i, loadImportPayload, seedLoadImport,
} from './helpers/loadImportDatabase';

vi.hoisted(async () => {
  const { Blob, File } = await import('node:buffer');
  vi.stubGlobal('Blob', Blob); vi.stubGlobal('File', File);
});

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), tenant: '', actor: '', lost: false, delay: false,
  release: null as null | (() => void),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));

let db: PGlite;
let client: QueryClient;
let transport: Promise<unknown> = Promise.resolve();

const commandInput = (): LoadImportCommandInput => {
  const payload = loadImportPayload();
  return {
    source_type: payload.source_type as 'spreadsheet', file_name: payload.file_name, file_count: payload.file_count,
    loads: payload.loads, documents: payload.documents as LoadImportCommandInput['documents'],
    unloading_charges: payload.unloading_charges,
  };
};

beforeAll(async () => { db = await createLoadImportDatabase(); }, 30_000);
afterAll(async () => { await db?.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await db.exec('begin'); await seedLoadImport(db); localStorage.clear(); vi.clearAllMocks();
  mock.tenant = i.tenant; mock.actor = i.operator; mock.lost = false; mock.delay = false; mock.release = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, work: () => Promise<unknown>) => work() } });
  mock.rpc.mockImplementation((name: string, args: { _payload: unknown }) => {
    let pending: Promise<unknown> | undefined;
    const run = () => {
      if (pending) return pending;
      const work = async () => {
        try {
          if (name !== 'apply_load_import_command') throw new Error(`Unexpected RPC ${name}`);
          if (mock.delay) { mock.delay = false; await new Promise<void>(resolve => { mock.release = resolve; }); }
          await db.query("select set_config('request.jwt.claim.sub',$1,false)", [mock.actor]);
          const data = await applyLoadImport(db, args._payload);
          if (mock.lost) { mock.lost = false; return { data: null, error: { message: 'Resposta perdida após confirmação no banco' } }; }
          return { data, error: null };
        } catch (error) { return { data: null, error }; }
      };
      pending = transport.then(work, work); transport = pending; return pending;
    };
    return { abortSignal: run, then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => run().then(resolve, reject) };
  });
});
afterEach(async () => {
  mock.release?.(); cleanup(); client.clear(); await transport; await db.exec('rollback'); localStorage.clear();
});

function Harness() {
  const command = useLoadImportCommand();
  const [message, setMessage] = useState('');
  const submit = async () => { try { const result = await command.submit(commandInput()); setMessage(`ok:${result.batch_id}`); } catch (error) { setMessage((error as Error).message); } };
  const recover = async () => { try { const result = await command.recover(); setMessage(`recovered:${result.batch_id}`); } catch (error) { setMessage((error as Error).message); } };
  return <div>
    <button type="button" onClick={submit} disabled={command.isPending || !!command.pending || !!command.recoveryError}>
      {command.isPending ? 'Importando…' : 'Importar'}
    </button>
    <button type="button" onClick={recover} disabled={command.isPending || !command.pending || !!command.recoveryError}>Recuperar importação</button>
    {command.pending && <span>Importação sem confirmação</span>}
    {command.recoveryError && <div role="alert">{command.recoveryError}</div>}
    <output>{message}</output>
  </div>;
}
const renderHarness = () => render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>);

describe('load import hook backed by the real SQL command', { timeout: 15_000 }, () => {
  it('uses only the canonical RPC and accepts only a compatible confirmation', async () => {
    renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(screen.getByText(/^ok:/)).toBeInTheDocument());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.rpc.mock.calls[0][0]).toBe('apply_load_import_command');
    expect((await db.query('select count(*)::int count from private.load_import_commands')).rows[0]).toEqual({ count: 1 });
  });

  it('keeps an uncertain command and recovers with the exact request UUID', async () => {
    mock.lost = true; renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await screen.findByText('Resposta perdida após confirmação no banco');
    const request = pendingLoadImportCommand(localStorage, i.tenant, i.operator)!.payload.request_id;
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Recuperar importação' }));
    await waitFor(() => expect(screen.getByText(/^recovered:/)).toBeInTheDocument());
    expect(mock.rpc.mock.calls.map(([, args]) => args._payload.request_id)).toEqual([request, request]);
    expect((await db.query('select count(*)::int count from private.load_import_commands')).rows[0]).toEqual({ count: 1 });
    expect(pendingLoadImportCommand(localStorage, i.tenant, i.operator)).toBeNull();
  });

  it('disables duplicate submission while the command is in flight', async () => {
    mock.delay = true; renderHarness(); fireEvent.click(screen.getByRole('button', { name: 'Importar' }));
    expect(await screen.findByRole('button', { name: 'Importando…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Importando…' }));
    expect(mock.rpc).toHaveBeenCalledTimes(1); mock.release?.();
    await waitFor(() => expect(screen.getByText(/^ok:/)).toBeInTheDocument());
  });

  it('fails closed when the durable outbox is incompatible', async () => {
    localStorage.setItem(`agvlog:load-import:v0:${i.tenant}:${i.operator}`, '{}');
    renderHarness();
    expect(screen.getByRole('alert')).toHaveTextContent('Recuperação da importação indisponível');
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
