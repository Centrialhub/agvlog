export type DurableOperatorAction = 'resolve_address' | 'upsert_geofence' | 'review_trip_cargo_divergence';

export interface DurableOperatorCommand {
  version: 1;
  tenantId: string;
  actorId: string;
  action: DurableOperatorAction;
  entityId: string;
  requestId: string;
  payloadHash: string;
  createdAt: string;
}

interface Dependencies {
  storage?: Storage;
  uuid?: () => string;
  now?: () => Date;
  digest?: (payload: string) => Promise<string>;
}

const prefix = 'agvlog:operator-command:v1';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error('operator_command_payload_invalid');
}

async function sha256(payload: string) {
  if (!globalThis.crypto?.subtle) throw new Error('operator_command_durable_hash_unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function scopedKey(input: Pick<DurableOperatorCommand, 'tenantId' | 'actorId' | 'action' | 'entityId'>) {
  return [prefix, input.tenantId, input.actorId, input.action, input.entityId].map(encodeURIComponent).join(':');
}

function parse(raw: string | null): DurableOperatorCommand | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DurableOperatorCommand>;
    if (value.version !== 1 || typeof value.tenantId !== 'string' || typeof value.actorId !== 'string'
      || !['resolve_address', 'upsert_geofence', 'review_trip_cargo_divergence'].includes(String(value.action))
      || typeof value.entityId !== 'string' || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{64}$/.test(String(value.payloadHash)) || typeof value.createdAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt))) return null;
    const valid = value as DurableOperatorCommand;
    return {
      version: 1,
      tenantId: valid.tenantId,
      actorId: valid.actorId,
      action: valid.action,
      entityId: valid.entityId,
      requestId: valid.requestId,
      payloadHash: valid.payloadHash,
      createdAt: valid.createdAt,
    };
  } catch {
    return null;
  }
}

function requiredStorage(storage?: Storage) {
  const target = storage ?? globalThis.localStorage;
  if (!target) throw new Error('operator_command_durable_storage_unavailable');
  return target;
}

export async function prepareDurableOperatorCommand(input: {
  tenantId: string;
  actorId: string;
  action: DurableOperatorAction;
  entityId: string;
  payload: unknown;
}, dependencies: Dependencies = {}): Promise<DurableOperatorCommand> {
  if (!input.tenantId || !input.actorId || !input.entityId) throw new Error('operator_command_scope_invalid');
  const storage = requiredStorage(dependencies.storage);
  const now = (dependencies.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) throw new Error('operator_command_time_invalid');
  const serialized = JSON.stringify(canonicalize(input.payload));
  const payloadHash = await (dependencies.digest ?? sha256)(serialized);
  if (!/^[0-9a-f]{64}$/.test(payloadHash)) throw new Error('operator_command_payload_hash_invalid');
  const key = scopedKey(input);
  const existing = parse(storage.getItem(key));
  if (existing && existing.tenantId === input.tenantId && existing.actorId === input.actorId
    && existing.action === input.action && existing.entityId === input.entityId
    && existing.payloadHash === payloadHash) {
    // Normalize the current slot so legacy/foreign fields (especially raw payloads)
    // cannot survive a successful rehydration.
    storage.setItem(key, JSON.stringify(existing));
    return existing;
  }
  const command: DurableOperatorCommand = {
    version: 1,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    entityId: input.entityId,
    requestId: (dependencies.uuid ?? (() => crypto.randomUUID()))(),
    payloadHash,
    createdAt: now.toISOString(),
  };
  storage.setItem(key, JSON.stringify(command));
  const persisted = parse(storage.getItem(key));
  if (!persisted || persisted.requestId !== command.requestId || persisted.payloadHash !== command.payloadHash) {
    throw new Error('operator_command_durable_storage_failed');
  }
  return persisted;
}

export function acknowledgeDurableOperatorCommand(command: DurableOperatorCommand, dependencies: Pick<Dependencies, 'storage'> = {}) {
  const storage = requiredStorage(dependencies.storage);
  const key = scopedKey(command);
  const current = parse(storage.getItem(key));
  if (current?.requestId === command.requestId && current.payloadHash === command.payloadHash) storage.removeItem(key);
}

export function readDurableOperatorCommand(input: Pick<DurableOperatorCommand,
  'tenantId' | 'actorId' | 'action' | 'entityId'>, dependencies: Pick<Dependencies, 'storage'> = {}) {
  return parse(requiredStorage(dependencies.storage).getItem(scopedKey(input)));
}
