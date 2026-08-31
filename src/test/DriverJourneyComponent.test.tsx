import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverJourney from '@/pages/driver/DriverJourney';

const mocks = vi.hoisted(() => ({
  events: [] as { id: string; event_type: string; event_at: string }[],
  failRead: false, pendingRead: false, preCompleted: true, postCompleted: true, activeTrip: true,
  rpc: vi.fn(), toast: vi.fn(), navigate: vi.fn(),
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user' } }) }));
vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({ data: { id: 'driver' }, refetch: vi.fn() }),
  useActiveTrip: () => ({ data: mocks.activeTrip ? { id: 'trip' } : null, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useChecklistStatus', () => ({ useChecklistStatus: () => ({
  preCompleted: mocks.preCompleted, postCompleted: mocks.postCompleted,
  preCheckedCount: 8, preTotalCount: 8, postCheckedCount: 5, postTotalCount: 5, isLoading: false, refetch: vi.fn(),
}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = {
      select: () => query, eq: () => query, in: () => query, order: () => query,
      then: (resolve: (value: unknown) => unknown) => mocks.pendingRead
        ? new Promise(() => undefined)
        : Promise.resolve({ data: mocks.events, error: mocks.failRead ? new Error('offline') : null }).then(resolve),
    };
    return query;
  },
  rpc: mocks.rpc,
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events = [];
  mocks.failRead = false;
  mocks.pendingRead = false;
  mocks.preCompleted = true;
  mocks.postCompleted = true;
  mocks.activeTrip = true;
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === 'driver_get_journey_context') {
      if (mocks.pendingRead) return new Promise(() => undefined);
      return { data: { events: mocks.events.map(event => ({ ...event, dispatch_trip_id: 'original-trip', created_at: event.event_at })),
        last_start: null, last_end: null }, error: mocks.failRead ? new Error('offline') : null };
    }
    mocks.events = [...mocks.events, { id: String(mocks.events.length), event_type: args._event_type, event_at: new Date().toISOString() }];
    return { data: 'event-id', error: null };
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

const button = (label: string) => {
  const match = [...container.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
};
async function flushUntil(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assertion();
  });
}
async function renderJourney() {
  await act(async () => root.render(<QueryClientProvider client={client}><DriverJourney /></QueryClientProvider>));
}

describe('driver journey rendered frontend', () => {
  it('keeps every event disabled until the backend state loads', async () => {
    mocks.pendingRead = true;
    await renderJourney();
    expect(container.textContent).toContain('Carregando jornada');
    expect(button('Início de Jornada')).toBeDisabled();
    expect(button('Almoço')).toBeDisabled();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'driver_create_event')).toHaveLength(0);
  });

  it('fails closed on query errors and provides a retry action', async () => {
    mocks.failRead = true;
    await renderJourney();
    await flushUntil(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(button('Início de Jornada')).toBeDisabled();
    mocks.failRead = false;
    await act(async () => button('Tentar novamente').click());
    await flushUntil(() => expect(button('Início de Jornada')).toBeEnabled());
  });

  it('registers start, reloads the timeline, and enables only working transitions', async () => {
    await renderJourney();
    await flushUntil(() => expect(button('Início de Jornada')).toBeEnabled());
    expect(button('Retomada')).toBeDisabled();
    await act(async () => button('Início de Jornada').click());
    await flushUntil(() => expect(button('Almoço')).toBeEnabled());
    expect(mocks.rpc).toHaveBeenCalledWith('driver_create_event', expect.objectContaining({ _trip_id: 'trip', _event_type: 'start_shift' }));
    expect(button('Início de Jornada')).toBeDisabled();
    expect(container.textContent).toContain('Em atividade');
  });

  it('requires resume during a pause and allows a fresh shift after completion', async () => {
    mocks.events = [{ id: 'pause', event_type: 'rest', event_at: new Date().toISOString() }];
    await renderJourney();
    await flushUntil(() => expect(button('Retomada')).toBeEnabled());
    expect(button('Fim de Jornada')).toBeDisabled();
    expect(button('Descanso')).toBeDisabled();
    mocks.events = [{ id: 'end', event_type: 'end_shift', event_at: new Date().toISOString() }];
    await act(async () => { await client.invalidateQueries({ queryKey: ['driver_journey_events'] }); });
    await flushUntil(() => expect(container.textContent).toContain('Encerrada'));
    expect(button('Início de Jornada')).toBeEnabled();
    for (const label of ['Almoço','Descanso','Pernoite','Retomada','Fim de Jornada']) expect(button(label)).toBeDisabled();
  });

  it('routes an incomplete checklist to its form without making a mutation', async () => {
    mocks.preCompleted = false;
    await renderJourney();
    await flushUntil(() => expect(button('Início de Jornada')).toBeEnabled());
    await act(async () => button('Início de Jornada').click());
    expect(mocks.navigate).toHaveBeenCalledWith('/driver/checklist?trip=trip');
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'driver_create_event')).toHaveLength(0);
  });

  it('finishes an open shift after the active trip has completed', async () => {
    mocks.activeTrip = false;
    mocks.events = [{ id: 'start', event_type: 'start_shift', event_at: new Date().toISOString() }];
    await renderJourney();
    await flushUntil(() => expect(button('Fim de Jornada')).toBeEnabled());
    await act(async () => button('Fim de Jornada').click());
    expect(mocks.rpc).toHaveBeenCalledWith('driver_create_event', expect.objectContaining({
      _trip_id: 'original-trip', _event_type: 'end_shift',
      _payload: expect.objectContaining({ expected_previous_event_id: 'start', client_event_id: expect.any(String) }),
    }));
  });

  it('retains the request key after a lost response and shows PostgREST errors', async () => {
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((name, args) => name === 'driver_create_event'
      ? Promise.resolve({ data: null, error: { message: 'Conexão interrompida' } }) : defaultRpc(name, args));
    await renderJourney();
    await flushUntil(() => expect(button('Início de Jornada')).toBeEnabled());
    await act(async () => button('Início de Jornada').click());
    await flushUntil(() => expect(button('Início de Jornada')).toBeEnabled());
    await act(async () => button('Início de Jornada').click());
    const calls = mocks.rpc.mock.calls.filter(([name]) => name === 'driver_create_event');
    expect(calls).toHaveLength(2);
    expect(calls[0][1]._payload.client_event_id).toBe(calls[1][1]._payload.client_event_id);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Conexão interrompida' }));
  });
});
