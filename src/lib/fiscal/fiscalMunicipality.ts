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
  if (aCode && bCode) return aCode === bCode;
  const aState = normalizeUf(a.state);
  const bState = normalizeUf(b.state);
  const aCity = normalizeCity(normalizeCityName(a.city));
  const bCity = normalizeCity(normalizeCityName(b.city));
  return !!aState && aState === bState && !!aCity && aCity === bCity;
}
