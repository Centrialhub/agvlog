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
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.max(0, Math.min(1, haversine))));
}

export function pointToLineDistanceMeters(
  point: Coordinate,
  line: { type: 'LineString'; coordinates: [number, number][] },
): number {
  if (!line?.coordinates?.length) return Number.POSITIVE_INFINITY;
  let minimum = Number.POSITIVE_INFINITY;
  let previous: Coordinate | undefined;
  for (const [lng, lat] of line.coordinates) {
    const current = {lat, lng};
    if (!validCoordinate(current) || !validCoordinate(point)) return Number.POSITIVE_INFINITY;
    minimum = Math.min(minimum, haversineMeters(point, current));
    if (previous) minimum = Math.min(minimum, segmentDistanceMeters(point, previous, current));
    previous = current;
  }
  return minimum;
}

function validCoordinate(p: Coordinate) {
  return Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

// Shortest great-circle arc, clamped to its endpoints (also across the date line).
function segmentDistanceMeters(p: Coordinate, a: Coordinate, b: Coordinate) {
  const radius = 6_371_000;
  const length = haversineMeters(a, b) / radius;
  const distance = haversineMeters(a, p) / radius;
  const endpoints = Math.min(distance * radius, haversineMeters(b, p));
  if (length < 1e-12 || Math.PI - length < 1e-12) return endpoints;
  const bearing = (x: Coordinate, y: Coordinate) => {
    const lat1=x.lat*Math.PI/180,lat2=y.lat*Math.PI/180,delta=(y.lng-x.lng)*Math.PI/180;
    return Math.atan2(Math.sin(delta)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(delta));
  };
  const difference = bearing(a,p)-bearing(a,b);
  const along = Math.atan2(Math.sin(distance)*Math.cos(difference),Math.cos(distance));
  if (along < 0 || along > length) return endpoints;
  const cross = Math.asin(Math.max(-1,Math.min(1,Math.sin(distance)*Math.sin(difference))));
  return Math.min(endpoints,Math.abs(cross)*radius);
}
