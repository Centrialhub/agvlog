import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverExpenseSyncAgent } from '@/components/driver/DriverExpenseSyncAgent';
import type { DriverStop } from '@/components/driver/deliveries/driverDeliveryEvents';
import { useDriverDeliveryStopsView } from '@/hooks/useDriverDeliveryStopsView';
import { expenseCreationContextInvalidated } from '@/lib/financial/expenseCreationCommands';

const expenseQueue = vi.hoisted(() => ({
  online: true,
  pending: [] as Array<{ requestId: string }>,
  replay: vi.fn(),
}));

vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => expenseQueue.online }));
vi.mock('@/hooks/useDriverExpensesOperational', () => ({
  useDriverExpenseSubmission: () => ({
    pending: { data: expenseQueue.pending },
    replay: { isPending: false, mutate: expenseQueue.replay },
  }),
}));

function stop(id: string, status: string, company: string): DriverStop {
  return {
    id,
    status,
    destination: company,
    notes: null,
    clients: { company_name: company, phone: null, mobile: null, email: null },
    dispatch_stop_documents: [],
  } as unknown as DriverStop;
}

afterEach(cleanup);
beforeEach(() => {
  expenseQueue.online = true;
  expenseQueue.pending = [];
  expenseQueue.replay.mockReset();
});

describe('bugs 582, 587, 593 e 594', () => {
  it('keeps independent searched counts and lists for open and completed stops', () => {
    const stops = [stop('open-alpha', 'pending', 'Alpha'), stop('open-beta', 'pending', 'Beta'), stop('done-alpha', 'completed', 'Alpha')];
    const { result } = renderHook(() => useDriverDeliveryStopsView(stops, new Set<string>()));

    expect(result.current.enRouteCount).toBe(2);
    act(() => result.current.setTab('concluidas'));
    expect(result.current.enRouteCount).toBe(2);
    expect(result.current.filteredStops.map((item) => item.id)).toEqual(['done-alpha']);

    act(() => result.current.setSearch('Beta'));
    expect(result.current.enRouteCount).toBe(1);
    expect(result.current.completedStops).toEqual([]);
  });

  it('invalidates expense creation only for server context conflicts', () => {
    expect(expenseCreationContextInvalidated(new Error('Informe um valor positivo.'))).toBe(false);
    expect(expenseCreationContextInvalidated(new Error('context_changed'))).toBe(true);
    expect(expenseCreationContextInvalidated(new Error('A viagem ou o acerto mudou ou está em uso. Atualize o contexto antes de registrar.'))).toBe(true);
  });

  it('registers only one delivery outbox listener in the sync banner source', async () => {
    const source = await import('@/components/driver/DriverDeliverySyncBanner?raw');
    expect(source.default.match(/addEventListener\(DRIVER_OFFLINE_OUTBOX_CHANGED/g)).toHaveLength(1);
  });

  it('replays again when a different pending expense arrives while still online', () => {
    expenseQueue.pending = [{ requestId: 'expense-a' }];
    const view = render(<DriverExpenseSyncAgent />);
    expect(expenseQueue.replay).toHaveBeenCalledTimes(1);

    expenseQueue.pending = [];
    view.rerender(<DriverExpenseSyncAgent />);
    expenseQueue.pending = [{ requestId: 'expense-b' }];
    view.rerender(<DriverExpenseSyncAgent />);
    expect(expenseQueue.replay).toHaveBeenCalledTimes(2);
  });
});
