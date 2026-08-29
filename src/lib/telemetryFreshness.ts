export const TELEMETRY_FRESH_THRESHOLD_MS = 10 * 60 * 1000;
export const TELEMETRY_OFFLINE_THRESHOLD_MS = 25 * 60 * 1000;

export type TelemetryFreshness = 'fresh' | 'stale' | 'offline' | 'unknown';

export interface TelemetryFreshnessSummary {
  total: number;
  withPosition: number;
  fresh: number;
  stale: number;
  offline: number;
  unknown: number;
}

export function classifyTelemetryFreshness(
  capturedAt: string | null | undefined,
  nowMs = Date.now(),
): TelemetryFreshness {
  if (!capturedAt) return 'unknown';

  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) return 'unknown';

  const ageMs = Math.max(0, nowMs - capturedAtMs);
  if (ageMs <= TELEMETRY_FRESH_THRESHOLD_MS) return 'fresh';
  if (ageMs <= TELEMETRY_OFFLINE_THRESHOLD_MS) return 'stale';
  return 'offline';
}

export function summarizeTelemetryFreshness(
  timestamps: ReadonlyArray<string | null | undefined>,
  nowMs = Date.now(),
): TelemetryFreshnessSummary {
  const summary: TelemetryFreshnessSummary = {
    total: timestamps.length,
    withPosition: 0,
    fresh: 0,
    stale: 0,
    offline: 0,
    unknown: 0,
  };

  for (const timestamp of timestamps) {
    const freshness = classifyTelemetryFreshness(timestamp, nowMs);
    summary[freshness] += 1;
    if (freshness !== 'unknown') summary.withPosition += 1;
  }

  return summary;
}
