// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import {
  acknowledgeDurableOperatorCommand,
  prepareDurableOperatorCommand,
  readDurableOperatorCommand,
} from '@/lib/operator/durableOperatorCommand';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
  dump() { return [...this.values.values()].join('\n'); }
}

const storage = new MemoryStorage();
const digest = async (value: string) => [...new TextEncoder().encode(value)]
  .reduce((hash, byte) => ((hash * 33) ^ byte) >>> 0, 5381).toString(16).padStart(8, '0').repeat(8);
let uuidSequence = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`;
const scope = { tenantId: 'tenant-a', actorId: 'actor-a', action: 'resolve_address' as const, entityId: 'queue-a' };

afterEach(() => { storage.clear();uuidSequence = 0; });

describe('durable operator command identity', () => {
  it.each([
    { action: 'resolve_address' as const, entityId: 'queue-a', payload: { longitude: -43, latitude: -16 } },
    { action: 'upsert_geofence' as const, entityId: 'new', payload: { radius_m: 150, address: 'Rua Reservada 42' } },
    { action: 'review_trip_cargo_divergence' as const, entityId: 'divergence-a', payload: { status: 'approved', reason: 'Motivo sigiloso' } },
  ])('rehydrates the same $action request after a hard reload without storing its payload', async variant => {
    const commandScope = { tenantId: scope.tenantId, actorId: scope.actorId, action: variant.action,
      entityId: variant.entityId };
    const first = await prepareDurableOperatorCommand({ ...commandScope, payload: variant.payload },
      { storage, digest, uuid });
    const rehydrated = await prepareDurableOperatorCommand({ ...commandScope,
      payload: Object.fromEntries(Object.entries(variant.payload).reverse()) }, { storage, digest, uuid });
    expect(rehydrated).toEqual(first);
    expect(readDurableOperatorCommand(commandScope, { storage })).toEqual(first);
    expect(storage.dump()).not.toContain('Rua Reservada');
    expect(storage.dump()).not.toContain('Motivo sigiloso');
    expect(storage.dump()).not.toContain('"payload"');
    expect(storage.length).toBe(1);
  });

  it('rotates request_id when the material payload changes and never lets a stale ACK delete it', async () => {
    const first = await prepareDurableOperatorCommand({ ...scope, payload: { latitude: -16, longitude: -43 } },
      { storage, digest, uuid });
    const changed = await prepareDurableOperatorCommand({ ...scope, payload: { latitude: -16, longitude: -44 } },
      { storage, digest, uuid });
    expect(changed.requestId).not.toBe(first.requestId);
    expect(changed.payloadHash).not.toBe(first.payloadHash);
    acknowledgeDurableOperatorCommand(first, { storage });
    expect(readDurableOperatorCommand(scope, { storage })).toEqual(changed);
    acknowledgeDurableOperatorCommand(changed, { storage });
    expect(readDurableOperatorCommand(scope, { storage })).toBeNull();
    expect(storage.length).toBe(0);
  });

  it('isolates identities by tenant, actor, entity and action', async () => {
    const variants = [
      scope,
      { ...scope, tenantId: 'tenant-b' },
      { ...scope, actorId: 'actor-b' },
      { ...scope, entityId: 'queue-b' },
      { ...scope, action: 'upsert_geofence' as const },
    ];
    const commands = [];
    for (const variant of variants) {
      commands.push(await prepareDurableOperatorCommand({ ...variant, payload: { value: 1 } },
        { storage, digest, uuid }));
    }
    expect(new Set(commands.map(command => command.requestId)).size).toBe(variants.length);
    expect(storage.length).toBe(variants.length);
  });

  it('keeps an uncertain request identity indefinitely until ACK or a material payload change', async () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const first = await prepareDurableOperatorCommand({ ...scope, payload: { value: 1 } },
      { storage, digest, uuid, now: () => start });
    const refreshed = await prepareDurableOperatorCommand({ ...scope, payload: { value: 1 } }, {
      storage, digest, uuid, now: () => new Date('2036-01-01T00:00:00.000Z'),
    });
    expect(refreshed).toEqual(first);
    expect(storage.length).toBe(1);
  });
});
