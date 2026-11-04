import type { CteParty } from './cteBuilder';
import { normalizeCityName, normalizeIbgeCity, normalizeUf } from './fiscalAddress';

/** Shared business-payload locality; the Hub accepts both canonical aliases. */
export function buildLocation(address?: CteParty['address'] | null): Record<string, unknown> | undefined {
  if (!address) return undefined;
  const city = normalizeCityName(address.city) || undefined;
  const uf = normalizeUf(address.state) || undefined;
  const cMun = normalizeIbgeCity(address.city_ibge) || undefined;
  if (!city && !uf && !cMun) return undefined;
  return { codigoCidade: cMun, cMun, municipio: city, cidade: city, uf, estado: uf };
}
