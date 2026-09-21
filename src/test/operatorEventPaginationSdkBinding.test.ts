import { beforeEach, expect, it, vi } from 'vitest';
import { callOperationalEventPage } from '@/lib/operationalEvents/operatorEventPagination';

const state = vi.hoisted(() => ({ rpc: vi.fn(), receivers: [] as unknown[] }));

vi.mock('@/integrations/supabase/client', () => {
  const client = {
    rpc(this: unknown, ...args: unknown[]) {
      state.receivers.push(this);
      if (this !== client) throw new Error('SDK receiver missing');
      return state.rpc(...args);
    },
  };
  return { supabase: client };
});

beforeEach(() => {
  state.rpc.mockReset();
  state.receivers.length = 0;
});

it('preserves the Supabase client receiver when reading an operational-event page', async () => {
  const args = {
    _tenant_id: '11000000-0000-4000-8000-000000000001',
    _filters: { status: 'all' },
    _limit: 500,
    _cursor: null,
  };
  const page = { version: 1, items: [], next_cursor: null };
  state.rpc.mockResolvedValue({ data: page, error: null });

  await expect(callOperationalEventPage(args)).resolves.toEqual(page);

  const { supabase } = await import('@/integrations/supabase/client');
  expect(state.rpc).toHaveBeenCalledWith('list_operational_events_page_v1', args);
  expect(state.receivers).toEqual([supabase]);
});
