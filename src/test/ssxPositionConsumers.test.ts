import { describe, expect, it } from 'vitest';
import {
  isFreshPositionObservation,
  resolvePositionTelemetry,
} from '@/lib/positionTelemetry';

const NOW = Date.parse('2026-08-31T18:00:00.000Z');

describe('SSX position consumer contract', () => {
  it('does not treat a state row without a position observation as stopped or fresh', () => {
    expect(resolvePositionTelemetry(null, {
      last_position_at: '2026-08-31T17:59:00.000Z',
      movement_state: 'stopped',
    }, NOW)).toEqual({
      capturedAt: null,
      freshness: 'unknown',
      hasObservation: false,
      movementState: 'unknown',
      speed: null,
    });
  });

  it('preserves unknown speed instead of converting it to zero/stopped', () => {
    const telemetry = resolvePositionTelemetry({
      captured_at: '2026-08-31T17:59:00.000Z',
      speed: null,
    }, {
      last_position_at: '2026-08-31T17:59:00.000Z',
      movement_state: 'stopped',
    }, NOW);

    expect(telemetry.speed).toBeNull();
    expect(telemetry.movementState).toBe('unknown');
    expect(telemetry.freshness).toBe('fresh');
  });

  it('keeps an observed zero as a real stopped reading', () => {
    const telemetry = resolvePositionTelemetry({
      captured_at: '2026-08-31T17:59:00.000Z',
      speed: 0,
    }, null, NOW);

    expect(telemetry.speed).toBe(0);
    expect(telemetry.movementState).toBe('stopped');
  });

  it('does not let a stale state row contradict a newer moving observation', () => {
    const telemetry = resolvePositionTelemetry({
      captured_at: '2026-08-31T17:59:00.000Z',
      speed: 42,
    }, {
      last_position_at: '2026-08-31T17:50:00.000Z',
      movement_state: 'stopped',
    }, NOW);

    expect(telemetry.movementState).toBe('moving');
    expect(telemetry.speed).toBe(42);
  });

  it('marks an old observation offline and never calls it current', () => {
    const position = { captured_at: '2026-08-31T17:30:00.000Z', speed: 31 };

    expect(resolvePositionTelemetry(position, null, NOW)).toMatchObject({
      movementState: 'offline',
      speed: null,
    });
    expect(isFreshPositionObservation(position, NOW)).toBe(false);
  });

  it('accepts only valid recent timestamps as current observations', () => {
    expect(isFreshPositionObservation({ captured_at: '2026-08-31T17:55:00.000Z' }, NOW)).toBe(true);
    expect(isFreshPositionObservation({ captured_at: 'invalid' }, NOW)).toBe(false);
    expect(isFreshPositionObservation(null, NOW)).toBe(false);
  });
});
