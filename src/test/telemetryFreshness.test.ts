import { describe, expect, it } from 'vitest';
import {
  classifyTelemetryFreshness,
  summarizeTelemetryFreshness,
  TELEMETRY_FRESH_THRESHOLD_MS,
  TELEMETRY_OFFLINE_THRESHOLD_MS,
} from '@/lib/telemetryFreshness';

describe('telemetry freshness policy', () => {
  const now = Date.parse('2026-08-26T12:00:00.000Z');

  it('uses the canonical 10-minute fresh and 25-minute offline boundaries', () => {
    expect(classifyTelemetryFreshness(new Date(now - TELEMETRY_FRESH_THRESHOLD_MS).toISOString(), now)).toBe('fresh');
    expect(classifyTelemetryFreshness(new Date(now - TELEMETRY_FRESH_THRESHOLD_MS - 1).toISOString(), now)).toBe('stale');
    expect(classifyTelemetryFreshness(new Date(now - TELEMETRY_OFFLINE_THRESHOLD_MS).toISOString(), now)).toBe('stale');
    expect(classifyTelemetryFreshness(new Date(now - TELEMETRY_OFFLINE_THRESHOLD_MS - 1).toISOString(), now)).toBe('offline');
  });

  it('keeps missing and malformed telemetry separate from offline vehicles', () => {
    expect(classifyTelemetryFreshness(null, now)).toBe('unknown');
    expect(classifyTelemetryFreshness('invalid', now)).toBe('unknown');
  });

  it('summarizes every active vehicle without collapsing unknown into offline', () => {
    expect(summarizeTelemetryFreshness([
      new Date(now - 5 * 60 * 1000).toISOString(),
      new Date(now - 15 * 60 * 1000).toISOString(),
      new Date(now - 30 * 60 * 1000).toISOString(),
      null,
    ], now)).toEqual({
      total: 4,
      withPosition: 3,
      fresh: 1,
      stale: 1,
      offline: 1,
      unknown: 1,
    });
  });
});
