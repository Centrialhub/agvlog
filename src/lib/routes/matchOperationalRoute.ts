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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWholePhrase(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(needle)}(\\s|$)`).test(haystack);
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

  const fuzzyMatches = exactMatches.length > 0
    ? []
    : routes.filter(route => route.destinations.some(destination => {
        const normalizedDestination = normalizeCity(destination.name);
        return containsWholePhrase(normalizedDestination, normalizedCity)
          || containsWholePhrase(normalizedCity, normalizedDestination);
      }));

  const candidates = exactMatches.length > 0 ? exactMatches : fuzzyMatches;
  const matched = candidates.length > 0
    ? [...candidates].sort((a, b) => a.name.localeCompare(b.name))[0]
    : null;

  return {
    matched,
    ambiguous: candidates.length > 1,
    exact: exactMatches.length > 0,
  };
}
