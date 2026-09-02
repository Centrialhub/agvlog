import type { RouteStopDraft } from './routePlanningTypes';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isValidLatitude = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value: unknown): value is number =>
  isFiniteNumber(value) && value >= -180 && value <= 180;

export const hasValidStopCoordinates = (
  stop: Pick<RouteStopDraft, 'latitude' | 'longitude'>,
): stop is Pick<RouteStopDraft, 'latitude' | 'longitude'> & { latitude: number; longitude: number } =>
  isValidLatitude(stop.latitude) && isValidLongitude(stop.longitude);

export const coordinateFromInput = (value: string): number | null => {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
