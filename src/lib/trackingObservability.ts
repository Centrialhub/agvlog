type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function requiredRecord(root: JsonRecord, key: string): JsonRecord {
  const value = root[key];
  if (!isRecord(value)) throw new Error(`Métricas de tracking incompatíveis: bloco ${key} ausente.`);
  return value;
}

function count(group: JsonRecord, key: string): number {
  const value = group[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Métricas de tracking incompatíveis: ${key} inválido.`);
  }
  return value;
}

function optionalPositiveNumber(group: JsonRecord, key: string, fallback: number): number {
  if (!(key in group)) return fallback;
  const value = group[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Métricas de tracking incompatíveis: ${key} inválido.`);
  }
  return value;
}

function optionalText(group: JsonRecord, key: string): string | null {
  const value = group[key];
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error(`Métricas de tracking incompatíveis: ${key} inválido.`);
  return value;
}

function optionalTimestamp(group: JsonRecord, key: string): string | null {
  const value = optionalText(group, key);
  if (value !== null && !Number.isFinite(new Date(value).getTime())) {
    throw new Error(`Métricas de tracking incompatíveis: ${key} não é uma data válida.`);
  }
  return value;
}

export interface TrackingObservability {
  positions: { fresh: number; stale: number; lastAt: string | null };
  trackerLinks: { active: number; conflicts: number };
  geofences: { fleet: number; delivery: number; events24h: number; lastEvaluatedAt: string | null };
  queue: { pending: number; errors: number };
  addresses: { pending: number; ambiguous: number; error: number };
  integration: { lastAt: string | null; success: boolean | null; action: string | null; error: string | null };
  schedule: { enabled: boolean; pollMinutes: number; fullSyncHours: number; lastFinishedAt: string | null; lastStatus: string | null; consecutiveFailures: number };
}

export function parseTrackingObservability(value: unknown): TrackingObservability {
  if (!isRecord(value)) throw new Error('A resposta de observabilidade não contém um envelope válido.');
  const positions = requiredRecord(value, 'positions');
  const trackerLinks = requiredRecord(value, 'tracker_links');
  const geofences = requiredRecord(value, 'geofences');
  const queue = requiredRecord(value, 'queue');
  const addresses = requiredRecord(value, 'addresses');
  const integration = requiredRecord(value, 'integration');
  const schedule = requiredRecord(value, 'schedule');
  const integrationSuccess = integration.success;
  if (integrationSuccess != null && typeof integrationSuccess !== 'boolean') {
    throw new Error('Métricas de tracking incompatíveis: success inválido.');
  }
  const scheduleEnabled = schedule.enabled;
  if (scheduleEnabled != null && typeof scheduleEnabled !== 'boolean') {
    throw new Error('Métricas de tracking incompatíveis: enabled inválido.');
  }
  return {
    positions: { fresh: count(positions, 'fresh'), stale: count(positions, 'stale'), lastAt: optionalTimestamp(positions, 'last_at') },
    trackerLinks: { active: count(trackerLinks, 'active'), conflicts: count(trackerLinks, 'conflicts') },
    geofences: {
      fleet: count(geofences, 'fleet'),
      delivery: count(geofences, 'delivery'),
      events24h: count(geofences, 'events_24h'),
      lastEvaluatedAt: optionalTimestamp(geofences, 'last_evaluated_at'),
    },
    queue: { pending: count(queue, 'pending'), errors: count(queue, 'errors') },
    addresses: { pending: count(addresses, 'pending'), ambiguous: count(addresses, 'ambiguous'), error: count(addresses, 'error') },
    integration: {
      lastAt: optionalTimestamp(integration, 'last_at'),
      success: typeof integrationSuccess === 'boolean' ? integrationSuccess : null,
      action: optionalText(integration, 'action'),
      error: optionalText(integration, 'error'),
    },
    schedule: {
      enabled: scheduleEnabled === true,
      pollMinutes: optionalPositiveNumber(schedule, 'poll_interval_minutes', 3),
      fullSyncHours: optionalPositiveNumber(schedule, 'full_sync_interval_hours', 6),
      lastFinishedAt: optionalTimestamp(schedule, 'last_finished_at'),
      lastStatus: optionalText(schedule, 'last_status'),
      consecutiveFailures: 'consecutive_failures' in schedule ? count(schedule, 'consecutive_failures') : 0,
    },
  };
}
