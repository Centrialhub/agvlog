export type Coordinate = { lat: number; lng: number };

export function haversineMeters(a: Coordinate, b: Coordinate): number {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lng - a.lng);
  const latitudeA = toRadians(a.lat);
  const latitudeB = toRadians(b.lat);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitudeA) * Math.cos(latitudeB);
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

export function pointToLineDistanceMeters(
  point: Coordinate,
  line: { type: 'LineString'; coordinates: [number, number][] },
): number {
  if (!line?.coordinates?.length) return Number.POSITIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  for (const [lng, lat] of line.coordinates) {
    minimum = Math.min(minimum, haversineMeters(point, { lat, lng }));
  }
  return minimum;
}
