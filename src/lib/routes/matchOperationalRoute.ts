import { normalizeCity } from '@/lib/utils/normalizeCity';

export interface OperationalRouteRef {
  id: string;
  name: string;
  destinations: Array<{ name: string }>;
}

export interface OperationalRouteMatch {
  matched: OperationalRouteRef | null;
  ambiguous: boolean;
  exact: boolean;
}

export function matchOperationalRoute(
  city: string,
  routes: OperationalRouteRef[],
): OperationalRouteMatch {
  const normalizedCity = normalizeCity(city);
  if (!normalizedCity) return { matched: null, ambiguous: false, exact: false };

  const exactMatches = routes.filter(route =>
    route.destinations.some(destination => normalizeCity(destination.name) === normalizedCity),
  );

  const candidates = exactMatches;
  const matched = candidates.length === 1 ? candidates[0] : null;

  return {
    matched,
    ambiguous: candidates.length > 1,
    exact: exactMatches.length > 0,
  };
}
