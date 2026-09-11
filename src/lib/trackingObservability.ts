type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value)
  ? value as JsonRecord : {};
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === 'string' ? value : null;

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
  const root = record(value);
  const positions = record(root.positions);
  const trackerLinks = record(root.tracker_links);
  const geofences = record(root.geofences);
  const queue = record(root.queue);
  const addresses = record(root.addresses);
  const integration = record(root.integration);
  const schedule = record(root.schedule);
  return {
    positions: { fresh: number(positions.fresh), stale: number(positions.stale), lastAt: text(positions.last_at) },
    trackerLinks: { active: number(trackerLinks.active), conflicts: number(trackerLinks.conflicts) },
    geofences: { fleet: number(geofences.fleet), delivery: number(geofences.delivery), events24h: number(geofences.events_24h), lastEvaluatedAt: text(geofences.last_evaluated_at) },
    queue: { pending: number(queue.pending), errors: number(queue.errors) },
    addresses: { pending: number(addresses.pending), ambiguous: number(addresses.ambiguous), error: number(addresses.error) },
    integration: { lastAt: text(integration.last_at), success: typeof integration.success === 'boolean' ? integration.success : null, action: text(integration.action), error: text(integration.error) },
    schedule: {
      enabled: schedule.enabled === true,
      pollMinutes: number(schedule.poll_interval_minutes) || 3,
      fullSyncHours: number(schedule.full_sync_interval_hours) || 6,
      lastFinishedAt: text(schedule.last_finished_at),
      lastStatus: text(schedule.last_status),
      consecutiveFailures: number(schedule.consecutive_failures),
    },
  };
}
