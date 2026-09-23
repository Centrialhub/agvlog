export const isValidLatitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;

export const isValidLongitude = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

export const hasValidGeographicCoordinates = (latitude: unknown, longitude: unknown): boolean =>
  isValidLatitude(latitude) && isValidLongitude(longitude);
