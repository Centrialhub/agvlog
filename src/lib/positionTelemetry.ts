import {
  classifyTelemetryFreshness,
  type TelemetryFreshness,
} from '@/lib/telemetryFreshness';

export type TelemetryMovementState = 'moving' | 'stopped' | 'idle' | 'offline' | 'unknown';

export interface PositionTelemetryInput {
  captured_at?: string | null;
  speed?: number | null;
}

export interface VehicleStateTelemetryInput {
  last_position_at?: string | null;
  movement_state?: string | null;
}

export interface PositionTelemetryPresentation {
  capturedAt: string | null;
  freshness: TelemetryFreshness;
  hasObservation: boolean;
  movementState: TelemetryMovementState;
  speed: number | null;
}

const MOVEMENT_STATES = new Set<TelemetryMovementState>([
  'moving',
  'stopped',
  'idle',
  'offline',
  'unknown',
]);

function validTimestamp(value: string | null | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function validSpeed(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function reportedMovementState(value: string | null | undefined): TelemetryMovementState | null {
  return value && MOVEMENT_STATES.has(value as TelemetryMovementState)
    ? value as TelemetryMovementState
    : null;
}

function timestampsMatch(left: string | null | undefined, right: string): boolean {
  if (!left) return false;
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

/**
 * Builds a conservative live-telemetry view from the authoritative position row.
 * A state-engine row alone is not proof that a position observation still exists,
 * and an unknown speed is intentionally different from a measured zero.
 */
export function resolvePositionTelemetry(
  position: PositionTelemetryInput | null | undefined,
  state?: VehicleStateTelemetryInput | null,
  nowMs = Date.now(),
): PositionTelemetryPresentation {
  const capturedAt = validTimestamp(position?.captured_at);
  if (!capturedAt) {
    return {
      capturedAt: null,
      freshness: 'unknown',
      hasObservation: false,
      movementState: 'unknown',
      speed: null,
    };
  }

  const freshness = classifyTelemetryFreshness(capturedAt, nowMs);
  const speed = validSpeed(position?.speed);

  if (freshness === 'offline') {
    return { capturedAt, freshness, hasObservation: true, movementState: 'offline', speed: null };
  }

  if (speed == null) {
    return { capturedAt, freshness, hasObservation: true, movementState: 'unknown', speed: null };
  }

  const reportedState = timestampsMatch(state?.last_position_at, capturedAt)
    ? reportedMovementState(state?.movement_state)
    : null;

  if (speed > 3) {
    return { capturedAt, freshness, hasObservation: true, movementState: 'moving', speed };
  }

  return {
    capturedAt,
    freshness,
    hasObservation: true,
    movementState: reportedState === 'idle' ? 'idle' : 'stopped',
    speed,
  };
}

export function isFreshPositionObservation(
  position: Pick<PositionTelemetryInput, 'captured_at'> | null | undefined,
  nowMs = Date.now(),
): boolean {
  return classifyTelemetryFreshness(position?.captured_at, nowMs) === 'fresh';
}
