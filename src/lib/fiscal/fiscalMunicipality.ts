import { normalizeCity } from '@/lib/utils/normalizeCity';
import { normalizeCityName, normalizeIbgeCity, normalizeUf } from '@/lib/fiscal/fiscalAddress';

export interface FiscalMunicipality {
  city?: string | null;
  state?: string | null;
  code?: string | null;
}

/** Compare municipalities, not just homonymous city names in different states. */
export function isSameFiscalMunicipality(a: FiscalMunicipality, b: FiscalMunicipality): boolean {
  const aCode = normalizeIbgeCity(a.code);
  const bCode = normalizeIbgeCity(b.code);
  const aState = normalizeUf(a.state);
  const bState = normalizeUf(b.state);
  const aCity = normalizeCity(normalizeCityName(a.city));
  const bCity = normalizeCity(normalizeCityName(b.city));
  // Use the same explicit city/UF destination as the availability lists.
  // A stale registry IBGE code must not turn a different named city into local freight.
  if (aState && bState && aCity && bCity) return aState === bState && aCity === bCity;
  if (aState && bState && aState !== bState) return false;
  return !!aCode && !!bCode && aCode === bCode;
}
