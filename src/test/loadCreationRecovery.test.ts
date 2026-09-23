import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLoadCreationOutbox, readPendingLoadCreations, type PendingLoadCreation } from '@/lib/loads/loadCreationOutbox';
import { suggestGroupDrivers, suggestGroupVehicles } from '@/lib/loads/groupAssignments';

const input = { changes: { destination: 'Salinas' }, document_ids: ['note-1'] };
const confirmed = (payload: PendingLoadCreation['payload']) => {
  const ids = payload.document_ids ?? payload.selected_document_ids;
  const documentIds = Array.isArray(ids) ? ids : [];
  return { data: {
    ok: true, tenant_id: payload.tenant_id, request_id: payload.request_id,
    load_id: 'load-1', load: { id: 'load-1', load_number: '1031' },
    document_count: documentIds.length + (payload.manual_document ? 1 : 0),
    document_ids: documentIds, manual_document_id: payload.manual_document ? 'manual-note-1' : null,
    replayed: true,
  }, error: null };
};
beforeEach(() => localStorage.clear());
function setup(send = vi.fn(async (_kind: string, payload: PendingLoadCreation['payload']) => confirmed(payload))) {
  const deps = { storage: localStorage, uuid: vi.fn(() => 'request-1'), assertContext: vi.fn(),
    lock: async <T>(_key: string, work: () => Promise<T>) => work(), send };
  return { deps, submit: createLoadCreationOutbox(deps) };
}

describe('durable load creation recovery', () => {
  it('survives a lost response and page reload with the original request and payload', async () => {
    const { deps, submit } = setup();
    deps.send.mockRejectedValueOnce(new Error('offline'));
    await expect(submit('tenant', 'actor', 'grouped', 'Salinas', input)).rejects.toThrow('sem confirmação');
    expect(readPendingLoadCreations(localStorage, 'tenant', 'actor', 'grouped')).toHaveLength(1);
    await createLoadCreationOutbox(deps)('tenant', 'actor', 'grouped', 'Salinas');
    expect(deps.send.mock.calls[1][1]).toEqual(deps.send.mock.calls[0][1]);
    expect(deps.uuid).toHaveBeenCalledTimes(1);
    expect(localStorage.length).toBe(0);
  });

  it('blocks an edited request while the original result is uncertain', async () => {
    const { deps, submit } = setup();
    deps.send.mockRejectedValueOnce(new Error('offline'));
    await expect(submit('tenant', 'actor', 'grouped', 'Salinas', input)).rejects.toThrow();
    await expect(submit('tenant', 'actor', 'grouped', 'Salinas', { ...input, document_ids: ['note-2'] })).rejects.toThrow('Recuperar criação');
    expect(deps.send).toHaveBeenCalledTimes(1);
  });

  it('does not erase a pending request for an invalid confirmation', async () => {
    const { deps, submit } = setup();
    deps.send.mockImplementationOnce(async () => ({ data: null, error: null }) as unknown as ReturnType<typeof confirmed>);
    await expect(submit('tenant', 'actor', 'grouped', 'Salinas', input)).rejects.toThrow('confirmação compatível');
    expect(localStorage.length).toBe(1);
  });

  it('keeps recovery pending when the confirmation names a different note with the same count', async () => {
    const { deps, submit } = setup();
    deps.send.mockImplementationOnce(async (_kind, payload) => ({
      ...confirmed(payload),
      data: { ...confirmed(payload).data, document_ids: ['note-2'] },
    }));
    await expect(submit('tenant', 'actor', 'grouped', 'Salinas', input)).rejects.toThrow('confirmação compatível');
    expect(readPendingLoadCreations(localStorage, 'tenant', 'actor', 'grouped')).toHaveLength(1);
  });

  it('confirms a manually entered note without requiring a preexisting document id', async () => {
    const { submit } = setup();
    await expect(submit('tenant', 'actor', 'documents', 'manual', {
      changes: { destination: 'Salinas' }, selected_document_ids: [],
      manual_document: { invoice_number: '123' },
    })).resolves.toMatchObject({ document_count: 1, document_ids: [] });
    expect(localStorage.length).toBe(0);
  });

  it('keeps a manual creation pending if its new note has no confirmed id', async () => {
    const { deps, submit } = setup();
    deps.send.mockImplementationOnce(async (_kind, payload) => ({
      ...confirmed(payload), data: { ...confirmed(payload).data, manual_document_id: null },
    }));
    await expect(submit('tenant', 'actor', 'documents', 'manual', {
      changes: { destination: 'Salinas' }, selected_document_ids: [],
      manual_document: { invoice_number: '123' },
    })).rejects.toThrow('confirmação compatível');
    expect(readPendingLoadCreations(localStorage, 'tenant', 'actor', 'documents')).toHaveLength(1);
  });

  it('refuses a command if durable storage cannot save it', async () => {
    const { deps } = setup();
    const storage = { ...localStorage, length: 0, setItem: () => { throw new Error('quota'); } } as Storage;
    await expect(createLoadCreationOutbox({ ...deps, storage })('tenant', 'actor', 'grouped', 'Salinas', input)).rejects.toThrow('quota');
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('isolates recovery by actor, tenant and creation screen', async () => {
    const { deps, submit } = setup();
    deps.send.mockRejectedValueOnce(new Error('offline'));
    await expect(submit('tenant', 'actor', 'grouped', 'Salinas', input)).rejects.toThrow();
    expect(readPendingLoadCreations(localStorage, 'other', 'actor', 'grouped')).toEqual([]);
    expect(readPendingLoadCreations(localStorage, 'tenant', 'other', 'grouped')).toEqual([]);
    expect(readPendingLoadCreations(localStorage, 'tenant', 'actor', 'documents')).toEqual([]);
  });
});

describe('manual route assignments', () => {
  const groups = [{ routeName: 'A', totalPallets: 1 }, { routeName: 'B', totalPallets: 1 }];
  const vehicles = [{ id: 'v1', max_pallets: 4, current_driver_id: 'd1' }, { id: 'v2', max_pallets: 8, current_driver_id: 'd2' }];
  it('preserves manual vehicles and explicit empty selections after a refetch', () => {
    const previous = new Map([['A', 'v2'], ['B', '']]);
    expect(suggestGroupVehicles([...groups], [...vehicles], previous)).toBe(previous);
  });
  it('suggests a vehicle only for a newly discovered route', () => {
    expect(suggestGroupVehicles(groups, vehicles, new Map([['A', 'v2']]))).toEqual(new Map([['A', 'v2'], ['B', 'v1']]));
  });
  it('changing another route vehicle preserves a manually selected driver', () => {
    const previous = new Map([['A', 'manual-driver'], ['B', 'd1']]);
    expect(suggestGroupDrivers(groups, vehicles, [{ id: 'd1' }, { id: 'd2' }], new Map([['A', 'v1'], ['B', 'v2']]), previous, new Set(['A'])))
      .toEqual(new Map([['A', 'manual-driver'], ['B', 'd2']]));
  });
  it('preserves an explicit no-driver choice', () => {
    expect(suggestGroupDrivers(groups.slice(0, 1), vehicles, [{ id: 'd1' }], new Map([['A', 'v1']]), new Map([['A', '']]), new Set(['A'])))
      .toEqual(new Map([['A', '']]));
  });
});
