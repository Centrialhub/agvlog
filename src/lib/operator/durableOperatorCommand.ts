export type DurableOperatorAction =
  | 'resolve_address'
  | 'upsert_geofence'
  | 'mutate_fleet_geofence'
  | 'review_trip_cargo_divergence'
  | 'create_pickup_order'
  | 'create_ort_pickup'
  | 'create_vehicle_fueling'
  | 'import_occurrence_report'
  | 'create_stock_movement'
  | 'create_inventory_movement'
  | 'create_employee_contract'
  | 'save_route_template'
  | 'delete_operational_route'
  | 'change_payroll_period_state'
  | 'approve_payroll_period'
  | 'close_payroll_period';

export interface DurableOperatorCommand {
  version: 1;
  tenantId: string;
  actorId: string;
  action: DurableOperatorAction;
  entityId: string;
  requestId: string;
  payloadHash: string;
  payload: unknown;
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
      || !['resolve_address', 'upsert_geofence', 'mutate_fleet_geofence', 'review_trip_cargo_divergence',
        'create_pickup_order', 'create_vehicle_fueling', 'import_occurrence_report', 'create_stock_movement', 'create_inventory_movement',
        'create_employee_contract', 'save_route_template', 'delete_operational_route', 'change_payroll_period_state',
        'approve_payroll_period', 'close_payroll_period']
        .includes(String(value.action))
      || typeof value.entityId !== 'string' || typeof value.requestId !== 'string'
      || !/^[0-9a-f]{64}$/.test(String(value.payloadHash)) || typeof value.createdAt !== 'string'
      || !Number.isFinite(Date.parse(value.createdAt)) || !Object.prototype.hasOwnProperty.call(value,'payload')) return null;
    const valid = value as DurableOperatorCommand;
    return {
      version: 1,
      tenantId: valid.tenantId,
      actorId: valid.actorId,
      action: valid.action,
      entityId: valid.entityId,
      requestId: valid.requestId,
      payloadHash: valid.payloadHash,
      payload: canonicalize(valid.payload),
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
    // Normalize the current slot and preserve the exact command for recovery.
    storage.setItem(key, JSON.stringify(existing));
    return existing;
  }
  if (existing) throw new Error('operator_command_pending_conflict');
  const command: DurableOperatorCommand = {
    version: 1,
    tenantId: input.tenantId,
    actorId: input.actorId,
    action: input.action,
    entityId: input.entityId,
    requestId: (dependencies.uuid ?? (() => crypto.randomUUID()))(),
    payloadHash,
    payload: canonicalize(input.payload),
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

/** Errors that confirm the server rejected the command before committing it. */
export function isDefinitiveOperatorCommandRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  return /^(22|23)/.test(code) || ['42501', 'P0001'].includes(code);
}
