import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import DriverJourney from '@/pages/driver/DriverJourney';
import DriverIssues from '@/pages/driver/DriverIssues';
import { DriverChecklistSection } from '@/components/driver/DriverChecklistSection';
import type { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';
import { DriverOperationalRecoveryProbe } from './DriverOperationalRecoveryProbe';
import { driverOfflineOutbox } from '@/lib/driver/driverOfflineOutbox';
import type { DriverOfflineEnvelope } from '@/lib/driver/driverOfflineOutbox';

const tenant = '73000000-0000-4000-8000-000000000001', actor = '73000000-0000-4000-8000-000000000002';
const trip = '73000000-0000-4000-8000-000000000003', driver = '73000000-0000-4000-8000-000000000004';
const params = new URLSearchParams(location.search);
const state = { tenant: params.get('tenant') ?? tenant, actor: params.get('actor') ?? actor,
  online: params.get('offline') !== '1', toasts: [] as unknown[], calls: [] as { name: string; args: Record<string, unknown> }[] };
const listeners = new Set<() => void>();
function useContextScope() { return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => `${state.tenant}:${state.actor}`); }
export function useAuth() { useContextScope(); return { user: { id: state.actor } }; }
export function useTenant() { useContextScope(); return { currentTenant: { id: state.tenant } }; }
export const useCurrentDriver = () => ({ data: { id: driver }, refetch: async () => undefined });
export const useActiveTrip = () => ({ data: { id: trip }, refetch: async () => undefined });
export const useChecklistStatus = () => ({ preCompleted: true, postCompleted: true,
  preTotalCount: 2, postTotalCount: 2, refetch: async () => undefined });
const events = [{ id: '73000000-0000-4000-8000-000000000005', dispatch_trip_id: trip,
  event_type: 'start_shift', event_at: '2026-10-14T04:00:00Z', created_at: '2026-10-14T04:00:00Z' }];
const journeyData = { events, last_start: null, last_end: null };
export const useDriverJourneyContext = () => ({ data: journeyData, refetch: async () => undefined });
export const useDriverOperationalEventHistory = () => ({ data: { items: [] }, isPending: false, refetch: async () => undefined });
export const useToast = () => ({ toast: (value: unknown) => { state.toasts.push(value); } });
export const supabase = {
  async rpc(name: string, args: Record<string, unknown>) {
    state.calls.push({ name, args: structuredClone(args) });
    const payload = args._payload as { trip_id: string };
    return { data: { version: 1, confirmed: true, replayed: false, tenant_id: args._tenant_id,
      actor_id: state.actor, request_id: args._request_id, command: args._command,
      trip_id: payload.trip_id, entity_id: '73000000-0000-4000-8000-000000000006' }, error: null };
  },
  from() { const query = { select: () => query, eq: () => query, order: async () => ({ data: [], error: null }) }; return query; },
  channel() { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: async () => undefined,
};
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let operational: ReturnType<typeof useDriverOperationalOffline>;
const captureOperational = (api: ReturnType<typeof useDriverOperationalOffline>) => { operational = api; };
function setOnline(online: boolean) {
  state.online = online; onlineManager.setOnline(online); window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}
Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => state.online });
setOnline(state.online);
const mode = params.get('mode') ?? 'journey';
createRoot(document.getElementById('root')!).render(<BrowserRouter><QueryClientProvider client={client}>
  {mode === 'journey' ? <DriverJourney /> : mode === 'occurrence' ? <DriverIssues /> :
    <DriverChecklistSection title="Pré-Viagem" kind="pre" items={['Pneus', 'Óleo']} tripId={trip}
      savedItems={[]} savedId={null} boundaryId={null} disabled={false} />}
  <DriverOperationalRecoveryProbe onReady={captureOperational} />
</QueryClientProvider></BrowserRouter>);
export const driverOperationalOfflineHarness = {
  setOnline,
  setContext(tenantId: string, actorId: string) { state.tenant = tenantId; state.actor = actorId; for (const listener of listeners) listener(); },
  inspect: async () => ({ rows: await driverOfflineOutbox.list(tenant, actor),
    calls: structuredClone(state.calls), toasts: structuredClone(state.toasts),
    mutations: client.getMutationCache().getAll().map(item => ({ status: item.state.status, isPaused: item.state.isPaused })) }),
  recover: async () => operational.recover(),
};
export type OperationalOfflineHarness = typeof driverOperationalOfflineHarness;
export type OperationalOfflineRow = DriverOfflineEnvelope;
Object.assign(globalThis, { driverOperationalOfflineHarness });
