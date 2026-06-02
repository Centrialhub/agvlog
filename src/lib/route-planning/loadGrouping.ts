import type { ConsolidationLoad } from './stopConsolidation';

export interface OperationalRouteLite {
  id: string;
  name: string;
  destinations: any[] | null;
  region_name: string | null;
}

export interface LoadGroup {
  key: string;
  name: string;
  loads: ConsolidationLoad[];
  requires_review: boolean;
  review_reason?: string;
  primary_city?: string | null;
  operational_route_id?: string | null;
}

const norm = (v?: string | null) => (v || '').trim().toUpperCase();

function predominantCity(load: ConsolidationLoad): string | null {
  const counts = new Map<string, number>();
  load.items.forEach((it) => {
    const c = norm(it.fiscal_documents?.recipient_city);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  });
  let best: string | null = null;
  let bestN = 0;
  counts.forEach((n, c) => { if (n > bestN) { best = c; bestN = n; } });
  return best;
}

function predominantNeighborhood(load: ConsolidationLoad): string | null {
  const counts = new Map<string, number>();
  load.items.forEach((it) => {
    const c = norm(it.fiscal_documents?.recipient_neighborhood);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  });
  let best: string | null = null;
  let bestN = 0;
  counts.forEach((n, c) => { if (n > bestN) { best = c; bestN = n; } });
  return best;
}

function distinctCities(load: ConsolidationLoad): number {
  const set = new Set<string>();
  load.items.forEach((it) => {
    const c = norm(it.fiscal_documents?.recipient_city);
    if (c) set.add(c);
  });
  return set.size;
}

function matchOperationalRoute(load: ConsolidationLoad, routes: OperationalRouteLite[]): OperationalRouteLite | null {
  if (!routes.length) return null;
  const city = predominantCity(load);
  if (!city) return null;
  for (const r of routes) {
    const dests = Array.isArray(r.destinations) ? r.destinations : [];
    const hit = dests.some((d: any) => {
      if (!d) return false;
      const dc = norm(typeof d === 'string' ? d : (d.city || d.name));
      return dc && dc === city;
    });
    if (hit) return r;
  }
  return null;
}

/**
 * Agrupa cargas de forma conservadora para roteirização.
 * Ordem: rota operacional > cidade predominante > bairro > destination textual.
 * Cargas com dados insuficientes ou cidades muito heterogêneas vão para "Revisão necessária".
 */
export function groupLoadsForRouting(
  loads: ConsolidationLoad[],
  operationalRoutes: OperationalRouteLite[] = [],
  maxStopsPerRoute = 30,
): LoadGroup[] {
  const groups = new Map<string, LoadGroup>();

  loads.forEach((load) => {
    const cities = distinctCities(load);
    const city = predominantCity(load);
    const neighborhood = predominantNeighborhood(load);
    const opRoute = matchOperationalRoute(load, operationalRoutes);

    let key: string;
    let name: string;
    let requires_review = false;
    let review_reason: string | undefined;
    let opRouteId: string | null = null;

    if (opRoute) {
      key = `op:${opRoute.id}`;
      name = opRoute.name;
      opRouteId = opRoute.id;
    } else if (city) {
      key = `city:${city}${neighborhood ? `|${neighborhood}` : ''}`;
      name = neighborhood ? `${city} · ${neighborhood}` : city;
    } else if (load.destination) {
      key = `dest:${norm(load.destination)}`;
      name = load.destination;
      requires_review = true;
      review_reason = 'Sem cidade nas NF-es; usando destino textual.';
    } else {
      key = `review:${load.id}`;
      name = 'Revisão necessária';
      requires_review = true;
      review_reason = 'Carga sem cidade nem destino identificável.';
    }

    if (cities > 3) {
      requires_review = true;
      review_reason = `Carga atende ${cities} cidades distintas.`;
    }

    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        name,
        loads: [],
        requires_review,
        review_reason,
        primary_city: city,
        operational_route_id: opRouteId,
      };
      groups.set(key, g);
    }
    g.loads.push(load);
    if (requires_review) {
      g.requires_review = true;
      g.review_reason = g.review_reason || review_reason;
    }
  });

  // Dividir grupos gigantes (mais que maxStopsPerRoute cargas) em subgrupos.
  const result: LoadGroup[] = [];
  groups.forEach((g) => {
    if (g.loads.length <= maxStopsPerRoute) {
      result.push(g);
      return;
    }
    let part = 1;
    for (let i = 0; i < g.loads.length; i += maxStopsPerRoute) {
      result.push({
        ...g,
        key: `${g.key}#${part}`,
        name: `${g.name} (parte ${part})`,
        loads: g.loads.slice(i, i + maxStopsPerRoute),
      });
      part++;
    }
  });

  return result;
}